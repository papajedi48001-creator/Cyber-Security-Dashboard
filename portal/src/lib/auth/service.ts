import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AuditLog } from "../audit";
import { ForbiddenError, requirePermission, type Role } from "./authorize";
import { dummyPasswordHash, hashPassword, verifyPassword } from "./password";
import { decryptSecret, encryptSecret, generateTotpSecret, otpauthUri, verifyTotp } from "./totp";

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60_000;
export const SESSION_IDLE_MS = 30 * 60_000;
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60_000;

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
}

export interface SessionStore {
  create(session: SessionRecord): Promise<void>;
  find(id: string): Promise<SessionRecord | null>;
  touch(id: string, lastSeenAt: Date): Promise<void>;
  delete(id: string): Promise<void>;
  deleteForUser(userId: string): Promise<void>;
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

export interface Enrollment {
  user: SessionUser;
  otpauthUri: string;
}

export interface AuthDeps {
  users: UserStore;
  sessions: SessionStore;
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

export function createAuthService({ users, sessions, audit, totpKey, clock = () => new Date() }: AuthDeps) {
  const invalid: AuthResult = { ok: false, reason: "invalid_credentials" };

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
      const token = randomBytes(32).toString("base64url");
      await sessions.create({
        id: hashToken(token),
        userId: user.id,
        csrfSecret: randomBytes(32).toString("base64url"),
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
      });
      await audit.append({
        actor: { id: user.id, label: user.username },
        action: "auth.login_succeeded",
        target: { type: "User", id: user.id },
        metadata: { ip: context.ip },
        correlationId: context.correlationId,
      });
      return { ok: true, token, user: toSessionUser(user) };
    },

    async validateSession(token: string | undefined | null): Promise<ValidSession | null> {
      if (!token) return null;
      const id = hashToken(token);
      const session = await sessions.find(id);
      if (!session) return null;
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

    async listUsers(actor: SessionUser): Promise<(SessionUser & { active: boolean; locked: boolean })[]> {
      requirePermission(actor, "user.manage");
      const now = clock();
      return (await users.list()).map((u) => ({
        ...toSessionUser(u),
        active: u.active,
        locked: !!u.lockedUntil && u.lockedUntil > now,
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
