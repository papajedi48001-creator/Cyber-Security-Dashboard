import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AuditLog } from "../audit";
import { ForbiddenError, requirePermission, type Role } from "./authorize";
import { dummyPasswordHash, hashPassword, verifyPassword } from "./password";
import { decryptSecret, encryptSecret, generateTotpSecret, otpauthUri, verifyTotp } from "./totp";

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60_000;
export const SESSION_IDLE_MS = 30 * 60_000;
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60_000;
/** How long a Provider ID Login may wait for the Portal TOTP code (ADR 0009). */
export const MFA_CHALLENGE_MS = 5 * 60_000;
export const PROVIDER_ID_ISSUER = "moph-provider-id";
const EXTERNAL_SUBJECT = /^[A-Za-z0-9._-]{1,64}$/;

export interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  passwordHash: string;
  totpSecretEnc: string | null;
  lastTotpStep: number | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  active: boolean;
}

export type NewUser = Pick<UserRecord, "username" | "displayName" | "role" | "passwordHash" | "totpSecretEnc">;
export type UserPatch = Partial<Omit<UserRecord, "id" | "username">>;

export interface UserStore {
  findById(id: string): Promise<UserRecord | null>;
  findByUsername(username: string): Promise<UserRecord | null>;
  list(): Promise<UserRecord[]>;
  create(user: NewUser): Promise<UserRecord>;
  update(id: string, patch: UserPatch): Promise<UserRecord>;
}

export interface SessionRecord {
  id: string;
  userId: string;
  csrfSecret: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  /** False while a Provider ID Login waits for the Portal TOTP code; such a row never authorizes anything. */
  mfaPassed: boolean;
}

export interface SessionStore {
  create(session: SessionRecord): Promise<void>;
  find(id: string): Promise<SessionRecord | null>;
  touch(id: string, lastSeenAt: Date): Promise<void>;
  delete(id: string): Promise<void>;
  deleteForUser(userId: string): Promise<void>;
}

/** A Provider ID Link: only the issuer and the external subject, never tokens or profiles (ADR 0009). */
export interface ExternalIdentityRecord {
  userId: string;
  issuer: string;
  subject: string;
  linkedAt: Date;
  linkedById: string;
}

export interface ExternalIdentityStore {
  findBySubject(issuer: string, subject: string): Promise<ExternalIdentityRecord | null>;
  findForUser(userId: string, issuer: string): Promise<ExternalIdentityRecord | null>;
  list(issuer: string): Promise<ExternalIdentityRecord[]>;
  link(record: ExternalIdentityRecord): Promise<void>;
  unlink(userId: string, issuer: string): Promise<boolean>;
}

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
}

export interface ValidSession {
  id: string;
  user: SessionUser;
  csrfToken: string;
}

export type AuthResult = { ok: true; token: string; user: SessionUser } | { ok: false; reason: "invalid_credentials" };
export type ExternalLoginResult = { ok: true; challenge: string } | { ok: false; reason: "not_linked" | "invalid_credentials" };

export interface Enrollment {
  user: SessionUser;
  otpauthUri: string;
}

export interface AuthDeps {
  users: UserStore;
  sessions: SessionStore;
  externalIdentities: ExternalIdentityStore;
  audit: AuditLog;
  totpKey: Buffer;
  clock?: () => Date;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const toSessionUser = (u: UserRecord): SessionUser => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  role: u.role,
});

export function createAuthService({ users, sessions, externalIdentities, audit, totpKey, clock = () => new Date() }: AuthDeps) {
  const invalid: AuthResult = { ok: false, reason: "invalid_credentials" };

  async function openSession(user: UserRecord, now: Date, ip: string, correlationId: string, method: string): Promise<AuthResult> {
    const token = randomBytes(32).toString("base64url");
    await sessions.create({
      id: hashToken(token),
      userId: user.id,
      csrfSecret: randomBytes(32).toString("base64url"),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
      mfaPassed: true,
    });
    await audit.append({
      actor: { id: user.id, label: user.username },
      action: "auth.login_succeeded",
      target: { type: "User", id: user.id },
      metadata: { ip, method },
      correlationId,
    });
    return { ok: true, token, user: toSessionUser(user) };
  }

  async function recordFailure(user: UserRecord, correlationId: string, ip: string) {
    const failed = user.failedLoginCount + 1;
    if (failed >= MAX_FAILED_LOGINS) {
      await users.update(user.id, { failedLoginCount: 0, lockedUntil: new Date(clock().getTime() + LOCKOUT_MS) });
      await audit.append({
        actor: { id: user.id, label: user.username },
        action: "auth.account_locked",
        target: { type: "User", id: user.id },
        metadata: { ip, lockMinutes: LOCKOUT_MS / 60_000 },
        correlationId,
      });
    } else {
      await users.update(user.id, { failedLoginCount: failed });
    }
  }

  return {
    async authenticate(
      credentials: { username: string; password: string; totpCode: string },
      context: { ip: string; correlationId: string },
    ): Promise<AuthResult> {
      const now = clock();
      const user = await users.findByUsername(credentials.username.trim());
      const failedAudit = (reason: string, target: UserRecord | null) =>
        audit.append({
          actor: { id: target?.id ?? null, label: target?.username ?? "anonymous" },
          action: "auth.login_failed",
          target: { type: "User", id: target?.id ?? null },
          metadata: { ip: context.ip, reason },
          correlationId: context.correlationId,
        });

      if (!user) {
        await verifyPassword(await dummyPasswordHash(), credentials.password);
        await failedAudit("unknown_user", null);
        return invalid;
      }
      if (!user.active) {
        await failedAudit("disabled", user);
        return invalid;
      }
      if (user.lockedUntil && user.lockedUntil > now) {
        await failedAudit("locked", user);
        return invalid;
      }
      const passwordOk = await verifyPassword(user.passwordHash, credentials.password);
      let step: number | null = null;
      if (passwordOk && user.totpSecretEnc) {
        step = verifyTotp(decryptSecret(user.totpSecretEnc, totpKey), credentials.totpCode.trim(), now, user.lastTotpStep);
      }
      if (!passwordOk || step === null) {
        await failedAudit(passwordOk ? "mfa" : "password", user);
        await recordFailure(user, context.correlationId, context.ip);
        return invalid;
      }

      await users.update(user.id, { failedLoginCount: 0, lockedUntil: null, lastTotpStep: step });
      return openSession(user, now, context.ip, context.correlationId, "password");
    },

    /**
     * Provider ID Login, step 1: the provider has identified the person. Opens a single-use MFA
     * challenge for the linked Portal User; it is not a session until completeMfaChallenge succeeds.
     */
    async beginExternalLogin(
      identity: { issuer: string; subject: string },
      context: { ip: string; correlationId: string },
    ): Promise<ExternalLoginResult> {
      const now = clock();
      const link = await externalIdentities.findBySubject(identity.issuer, identity.subject);
      const user = link ? await users.findById(link.userId) : null;
      const fail = async (reason: string) =>
        audit.append({
          actor: { id: user?.id ?? null, label: user?.username ?? "anonymous" },
          action: "auth.login_failed",
          target: { type: "User", id: user?.id ?? null },
          metadata: { ip: context.ip, reason, method: "provider_id" },
          correlationId: context.correlationId,
        });
      if (!user) {
        await fail("not_linked");
        return { ok: false, reason: "not_linked" };
      }
      const reason = !user.active
        ? "disabled"
        : user.lockedUntil && user.lockedUntil > now
          ? "locked"
          : !user.totpSecretEnc
            ? "mfa_not_enrolled"
            : null;
      if (reason) {
        await fail(reason);
        return { ok: false, reason: "invalid_credentials" };
      }
      const challenge = randomBytes(32).toString("base64url");
      await sessions.create({
        id: hashToken(challenge),
        userId: user.id,
        csrfSecret: randomBytes(32).toString("base64url"),
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + MFA_CHALLENGE_MS),
        mfaPassed: false,
      });
      return { ok: true, challenge };
    },

    /** Provider ID Login, step 2: one TOTP attempt per challenge; success issues a fresh session token. */
    async completeMfaChallenge(
      challenge: string | undefined | null,
      totpCode: string,
      context: { ip: string; correlationId: string },
    ): Promise<AuthResult> {
      if (!challenge) return invalid;
      const now = clock();
      const id = hashToken(challenge);
      const pending = await sessions.find(id);
      if (!pending || pending.mfaPassed) return invalid;
      await sessions.delete(id);
      if (now >= pending.expiresAt) return invalid;
      const user = await users.findById(pending.userId);
      if (!user || !user.active || !user.totpSecretEnc || (user.lockedUntil && user.lockedUntil > now)) return invalid;
      const step = verifyTotp(decryptSecret(user.totpSecretEnc, totpKey), totpCode.trim(), now, user.lastTotpStep);
      if (step === null) {
        await audit.append({
          actor: { id: user.id, label: user.username },
          action: "auth.login_failed",
          target: { type: "User", id: user.id },
          metadata: { ip: context.ip, reason: "mfa", method: "provider_id" },
          correlationId: context.correlationId,
        });
        await recordFailure(user, context.correlationId, context.ip);
        return invalid;
      }
      await users.update(user.id, { failedLoginCount: 0, lockedUntil: null, lastTotpStep: step });
      return openSession(user, now, context.ip, context.correlationId, "provider_id");
    },

    async linkExternalIdentity(input: {
      actor: SessionUser;
      userId: string;
      issuer: string;
      subject: string;
      correlationId: string;
    }): Promise<void> {
      requirePermission(input.actor, "user.manage");
      const subject = input.subject.trim();
      if (!EXTERNAL_SUBJECT.test(subject)) throw new Error("Provider ID ต้องเป็น A-Z a-z 0-9 . _ - ยาวไม่เกิน 64 ตัวอักษร");
      if (!(await users.findById(input.userId))) throw new ForbiddenError();
      if (await externalIdentities.findBySubject(input.issuer, subject)) throw new Error("Provider ID นี้ผูกกับผู้ใช้แล้ว");
      if (await externalIdentities.findForUser(input.userId, input.issuer))
        throw new Error("ผู้ใช้นี้มี Provider ID อยู่แล้ว ต้องยกเลิกการผูกเดิมก่อน");
      await externalIdentities.link({
        userId: input.userId,
        issuer: input.issuer,
        subject,
        linkedAt: clock(),
        linkedById: input.actor.id,
      });
      await audit.append({
        actor: { id: input.actor.id, label: input.actor.username },
        action: "user.external_identity_linked",
        target: { type: "User", id: input.userId },
        metadata: { issuer: input.issuer, subject },
        correlationId: input.correlationId,
      });
    },

    async unlinkExternalIdentity(input: { actor: SessionUser; userId: string; issuer: string; correlationId: string }): Promise<void> {
      requirePermission(input.actor, "user.manage");
      if (!(await externalIdentities.unlink(input.userId, input.issuer))) return;
      await audit.append({
        actor: { id: input.actor.id, label: input.actor.username },
        action: "user.external_identity_unlinked",
        target: { type: "User", id: input.userId },
        metadata: { issuer: input.issuer },
        correlationId: input.correlationId,
      });
    },

    async validateSession(token: string | undefined | null): Promise<ValidSession | null> {
      if (!token) return null;
      const id = hashToken(token);
      const session = await sessions.find(id);
      if (!session || !session.mfaPassed) return null;
      const now = clock();
      if (now >= session.expiresAt || now.getTime() - session.lastSeenAt.getTime() > SESSION_IDLE_MS) {
        await sessions.delete(id);
        return null;
      }
      const user = await users.findById(session.userId);
      if (!user || !user.active) {
        await sessions.delete(id);
        return null;
      }
      await sessions.touch(id, now);
      return { id, user: toSessionUser(user), csrfToken: session.csrfSecret };
    },

    verifyCsrf(session: ValidSession, token: string | undefined | null): boolean {
      if (!token) return false;
      const expected = Buffer.from(session.csrfToken);
      const given = Buffer.from(token);
      return expected.length === given.length && timingSafeEqual(expected, given);
    },

    async logout(token: string | undefined | null, correlationId: string): Promise<void> {
      if (!token) return;
      const id = hashToken(token);
      const session = await sessions.find(id);
      await sessions.delete(id);
      if (session)
        await audit.append({
          actor: { id: session.userId, label: session.userId },
          action: "auth.logout",
          target: { type: "User", id: session.userId },
          correlationId,
        });
    },

    async createUser(input: {
      actor: SessionUser;
      username: string;
      displayName: string;
      role: Role;
      password: string;
      correlationId: string;
    }): Promise<Enrollment> {
      requirePermission(input.actor, "user.manage");
      const username = input.username.trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,64}$/.test(username)) throw new Error("ชื่อผู้ใช้ต้องเป็น a-z 0-9 . _ - ยาว 3-64 ตัวอักษร");
      if (await users.findByUsername(username)) throw new Error("ชื่อผู้ใช้นี้มีอยู่แล้ว");
      const secret = generateTotpSecret();
      const user = await users.create({
        username,
        displayName: input.displayName.trim(),
        role: input.role,
        passwordHash: await hashPassword(input.password),
        totpSecretEnc: encryptSecret(secret, totpKey),
      });
      await audit.append({
        actor: { id: input.actor.id, label: input.actor.username },
        action: "user.created",
        target: { type: "User", id: user.id },
        metadata: { username, role: input.role },
        correlationId: input.correlationId,
      });
      return { user: toSessionUser(user), otpauthUri: otpauthUri(secret, username) };
    },

    async resetMfa(input: { actor: { id: string; role: Role; username?: string }; userId: string; correlationId: string }) {
      requirePermission(input.actor, "user.manage");
      if (input.actor.id === input.userId) throw new ForbiddenError();
      const user = await users.findById(input.userId);
      if (!user) throw new ForbiddenError();
      const secret = generateTotpSecret();
      await users.update(user.id, { totpSecretEnc: encryptSecret(secret, totpKey), lastTotpStep: null });
      await sessions.deleteForUser(user.id);
      await audit.append({
        actor: { id: input.actor.id, label: input.actor.username ?? input.actor.id },
        action: "user.mfa_reset",
        target: { type: "User", id: user.id },
        correlationId: input.correlationId,
      });
      return { user: toSessionUser(user), otpauthUri: otpauthUri(secret, user.username) } satisfies Enrollment;
    },

    async setActive(input: { actor: SessionUser; userId: string; active: boolean; correlationId: string }) {
      requirePermission(input.actor, "user.manage");
      if (input.actor.id === input.userId) throw new ForbiddenError();
      await users.update(input.userId, { active: input.active });
      if (!input.active) await sessions.deleteForUser(input.userId);
      await audit.append({
        actor: { id: input.actor.id, label: input.actor.username },
        action: input.active ? "user.enabled" : "user.disabled",
        target: { type: "User", id: input.userId },
        correlationId: input.correlationId,
      });
    },

    async listUsers(
      actor: SessionUser,
    ): Promise<(SessionUser & { active: boolean; locked: boolean; providerId: string | null })[]> {
      requirePermission(actor, "user.manage");
      const now = clock();
      const links = new Map((await externalIdentities.list(PROVIDER_ID_ISSUER)).map((l) => [l.userId, l.subject]));
      return (await users.list()).map((u) => ({
        ...toSessionUser(u),
        active: u.active,
        locked: !!u.lockedUntil && u.lockedUntil > now,
        providerId: links.get(u.id) ?? null,
      }));
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;

export class InMemoryUserStore implements UserStore {
  private readonly users = new Map<string, UserRecord>();

  async findById(id: string) {
    return this.users.get(id) ?? null;
  }
  async findByUsername(username: string) {
    return [...this.users.values()].find((u) => u.username === username) ?? null;
  }
  async list() {
    return [...this.users.values()];
  }
  async create(user: NewUser) {
    const record: UserRecord = {
      ...user,
      id: `user-${this.users.size + 1}`,
      lastTotpStep: null,
      failedLoginCount: 0,
      lockedUntil: null,
      active: true,
    };
    this.users.set(record.id, record);
    return record;
  }
  async update(id: string, patch: UserPatch) {
    const current = this.users.get(id);
    if (!current) throw new Error("user not found");
    const next = { ...current, ...patch };
    this.users.set(id, next);
    return next;
  }
}

export class InMemorySessionStore implements SessionStore {
  readonly byId = new Map<string, SessionRecord>();

  async create(session: SessionRecord) {
    this.byId.set(session.id, session);
  }
  async find(id: string) {
    return this.byId.get(id) ?? null;
  }
  async touch(id: string, lastSeenAt: Date) {
    const s = this.byId.get(id);
    if (s) this.byId.set(id, { ...s, lastSeenAt });
  }
  async delete(id: string) {
    this.byId.delete(id);
  }
  async deleteForUser(userId: string) {
    for (const [id, s] of this.byId) if (s.userId === userId) this.byId.delete(id);
  }
}

export class InMemoryExternalIdentityStore implements ExternalIdentityStore {
  private readonly links: ExternalIdentityRecord[] = [];

  async findBySubject(issuer: string, subject: string) {
    return this.links.find((l) => l.issuer === issuer && l.subject === subject) ?? null;
  }
  async findForUser(userId: string, issuer: string) {
    return this.links.find((l) => l.userId === userId && l.issuer === issuer) ?? null;
  }
  async list(issuer: string) {
    return this.links.filter((l) => l.issuer === issuer);
  }
  async link(record: ExternalIdentityRecord) {
    if (this.links.some((l) => l.issuer === record.issuer && (l.subject === record.subject || l.userId === record.userId)))
      throw new Error("external identity already linked");
    this.links.push(record);
  }
  async unlink(userId: string, issuer: string) {
    const index = this.links.findIndex((l) => l.userId === userId && l.issuer === issuer);
    if (index < 0) return false;
    this.links.splice(index, 1);
    return true;
  }
}
