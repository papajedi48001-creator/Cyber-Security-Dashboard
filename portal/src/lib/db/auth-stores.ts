import type { Prisma, PrismaClient, User } from "@prisma/client";
import type { NewUser, SessionRecord, SessionStore, UserPatch, UserRecord, UserStore } from "../auth/service";

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
    await this.db.session.create({ data: { ...session, mfaPassed: true } });
  }
  async find(id: string) {
    const s = await this.db.session.findUnique({ where: { id } });
    return s
      ? { id: s.id, userId: s.userId, csrfSecret: s.csrfSecret, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, expiresAt: s.expiresAt }
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
