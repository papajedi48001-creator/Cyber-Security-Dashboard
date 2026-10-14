import type { Prisma, PrismaClient } from "@prisma/client";
import type { Asset, AssetStore } from "../assets/service";

type Db = PrismaClient | Prisma.TransactionClient;
const select = {
  id: true, name: true, role: true, owner: true, critical: true, criticalReason: true, createdAt: true, updatedAt: true,
} as const;

export class PrismaAssetStore implements AssetStore {
  constructor(private readonly db: Db) {}

  list(filter?: { critical?: boolean }): Promise<Asset[]> {
    return this.db.asset.findMany({
      where: filter?.critical === undefined ? {} : { critical: filter.critical },
      orderBy: { name: "asc" },
      select,
    });
  }
  findById(id: string) {
    return this.db.asset.findUnique({ where: { id }, select });
  }
  findByName(name: string) {
    return this.db.asset.findUnique({ where: { name }, select });
  }
  create(input: Omit<Asset, "id" | "createdAt" | "updatedAt">) {
    return this.db.asset.create({ data: input, select });
  }
  update(id: string, patch: Partial<Omit<Asset, "id" | "createdAt" | "updatedAt">>) {
    return this.db.asset.update({ where: { id }, data: patch, select });
  }
}
