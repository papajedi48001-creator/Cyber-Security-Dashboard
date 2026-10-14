import type { Prisma, PrismaClient, User } from "@prisma/client";
import type {
  ExternalIdentityRecord,
  ExternalIdentityStore,
  NewUser,
  SessionRecord,
  SessionStore,
  UserPatch,
  UserRecord,
  UserStore,
} from "../auth/service";

type Db = PrismaClient | Prisma.TransactionClient;

function toRecord(u: User): UserRecord {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    passwordHash: u.passwordHash,
    totpSecretEnc: u.totpSecretEnc,
    lastTotpStep: u.lastTotpStep === null ? null : Number(u.lastTotpStep),
    failedLoginCount: u.failedLoginCount,
    lockedUntil: u.lockedUntil,
    active: u.active,
  };
}

export class PrismaUserStore implements UserStore {
  constructor(private readonly db: Db) {}

  async findById(id: string) {
    const u = await this.db.user.findUnique({ where: { id } });
    return u ? toRecord(u) : null;
  }
  async findByUsername(username: string) {
    const u = await this.db.user.findUnique({ where: { username } });
    return u ? toRecord(u) : null;
  }
  async list() {
    return (await this.db.user.findMany({ orderBy: { username: "asc" } })).map(toRecord);
  }
  async create(user: NewUser) {
    return toRecord(await this.db.user.create({ data: user }));
  }
  async update(id: string, patch: UserPatch) {
    const { lastTotpStep, ...rest } = patch;
    const data: Prisma.UserUpdateInput = { ...rest };
    if (lastTotpStep !== undefined) data.lastTotpStep = lastTotpStep === null ? null : BigInt(lastTotpStep);
    return toRecord(await this.db.user.update({ where: { id }, data }));
  }
}

export class PrismaSessionStore implements SessionStore {
  constructor(private readonly db: Db) {}

  async create(session: SessionRecord) {
    await this.db.session.create({ data: session });
  }
  async find(id: string) {
    const s = await this.db.session.findUnique({ where: { id } });
    return s
      ? {
          id: s.id,
          userId: s.userId,
          csrfSecret: s.csrfSecret,
          createdAt: s.createdAt,
          lastSeenAt: s.lastSeenAt,
          expiresAt: s.expiresAt,
          mfaPassed: s.mfaPassed,
        }
      : null;
  }
  async touch(id: string, lastSeenAt: Date) {
    await this.db.session.updateMany({ where: { id }, data: { lastSeenAt } });
  }
  async delete(id: string) {
    await this.db.session.deleteMany({ where: { id } });
  }
  async deleteForUser(userId: string) {
    await this.db.session.deleteMany({ where: { userId } });
  }
}

const toLink = (l: ExternalIdentityRecord) => ({
  userId: l.userId,
  issuer: l.issuer,
  subject: l.subject,
  linkedAt: l.linkedAt,
  linkedById: l.linkedById,
});

export class PrismaExternalIdentityStore implements ExternalIdentityStore {
  constructor(private readonly db: Db) {}

  async findBySubject(issuer: string, subject: string) {
    const l = await this.db.externalIdentity.findUnique({ where: { issuer_subject: { issuer, subject } } });
    return l ? toLink(l) : null;
  }
  async findForUser(userId: string, issuer: string) {
    const l = await this.db.externalIdentity.findUnique({ where: { userId_issuer: { userId, issuer } } });
    return l ? toLink(l) : null;
  }
  async list(issuer: string) {
    return (await this.db.externalIdentity.findMany({ where: { issuer } })).map(toLink);
  }
  async link(record: ExternalIdentityRecord) {
    await this.db.externalIdentity.create({ data: record });
  }
  async unlink(userId: string, issuer: string) {
    return (await this.db.externalIdentity.deleteMany({ where: { userId, issuer } })).count > 0;
  }
}
