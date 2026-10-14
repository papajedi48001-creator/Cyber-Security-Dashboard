import type { AuditLog } from "../audit";
import { requirePermission, type Principal } from "../auth/authorize";

export interface Asset {
  id: string;
  name: string;
  role: string;
  owner: string;
  critical: boolean;
  criticalReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssetInput {
  name: string;
  role: string;
  owner: string;
  critical: boolean;
  criticalReason?: string | null;
}

export type AssetPatch = Partial<AssetInput>;

export interface AssetStore {
  list(filter?: { critical?: boolean }): Promise<Asset[]>;
  findById(id: string): Promise<Asset | null>;
  findByName(name: string): Promise<Asset | null>;
  create(input: Omit<Asset, "id" | "createdAt" | "updatedAt">): Promise<Asset>;
  update(id: string, patch: Partial<Omit<Asset, "id" | "createdAt" | "updatedAt">>): Promise<Asset>;
}

export class AssetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetValidationError";
  }
}

type Actor = Principal & { username: string };

const NATIONAL_ID = /(?<!\d)\d{13}(?!\d)/;

function clean(value: string | undefined | null, field: string, max: number, required = true): string {
  const text = (value ?? "").trim();
  if (required && !text) throw new AssetValidationError(`${field} ต้องไม่ว่าง`);
  if (text.length > max) throw new AssetValidationError(`${field} ยาวเกิน ${max} ตัวอักษร`);
  if (NATIONAL_ID.test(text)) throw new AssetValidationError(`${field} ต้องไม่มีข้อมูลส่วนบุคคลหรือข้อมูลผู้ป่วย`);
  return text;
}

function normalise(input: AssetInput) {
  const name = clean(input.name, "ชื่อ", 128);
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new AssetValidationError("ชื่อ asset ใช้ได้เฉพาะ A-Z a-z 0-9 . _ -");
  const criticalReason = input.critical ? clean(input.criticalReason, "เหตุผลที่เป็น Critical Asset", 500) : null;
  return {
    name,
    role: clean(input.role, "หน้าที่", 255),
    owner: clean(input.owner, "ผู้รับผิดชอบ", 128),
    critical: input.critical,
    criticalReason,
  };
}

export function createAssetService({ store, audit }: { store: AssetStore; audit: AuditLog }) {
  const record = (actor: Actor, action: string, asset: Asset, correlationId: string, metadata?: Record<string, unknown>) =>
    audit.append({
      actor: { id: actor.id, label: actor.username },
      action,
      target: { type: "Asset", id: asset.id },
      metadata: { name: asset.name, ...metadata },
      correlationId,
    });

  return {
    async listAssets(actor: Principal, filter?: { critical?: boolean }) {
      requirePermission(actor, "asset.read");
      return store.list(filter);
    },

    async createAsset(actor: Actor, input: AssetInput, correlationId: string) {
      requirePermission(actor, "asset.write");
      const data = normalise(input);
      if (await store.findByName(data.name)) throw new AssetValidationError("มี asset ชื่อนี้แล้ว");
      const asset = await store.create(data);
      await record(actor, "asset.created", asset, correlationId, { critical: asset.critical });
      return asset;
    },

    async updateAsset(actor: Actor, id: string, patch: AssetPatch, correlationId: string) {
      requirePermission(actor, "asset.write");
      const current = await store.findById(id);
      if (!current) throw new AssetValidationError("ไม่พบ asset");
      const data = normalise({ ...current, ...patch });
      if (data.name !== current.name && (await store.findByName(data.name)))
        throw new AssetValidationError("มี asset ชื่อนี้แล้ว");
      const asset = await store.update(id, data);
      await record(actor, "asset.updated", asset, correlationId, { fields: Object.keys(patch) });
      return asset;
    },

    async markCriticalAsset(actor: Actor, id: string, reason: string, correlationId: string) {
      requirePermission(actor, "asset.write");
      const current = await store.findById(id);
      if (!current) throw new AssetValidationError("ไม่พบ asset");
      const data = normalise({ ...current, critical: true, criticalReason: reason });
      const asset = await store.update(id, data);
      await record(actor, "asset.marked_critical", asset, correlationId);
      return asset;
    },
  };
}

export type AssetService = ReturnType<typeof createAssetService>;

export class InMemoryAssetStore implements AssetStore {
  private readonly assets = new Map<string, Asset>();

  async list(filter?: { critical?: boolean }) {
    return [...this.assets.values()]
      .filter((a) => filter?.critical === undefined || a.critical === filter.critical)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  async findById(id: string) {
    return this.assets.get(id) ?? null;
  }
  async findByName(name: string) {
    return [...this.assets.values()].find((a) => a.name === name) ?? null;
  }
  async create(input: Omit<Asset, "id" | "createdAt" | "updatedAt">) {
    const now = new Date();
    const asset = { ...input, id: `asset-${this.assets.size + 1}`, createdAt: now, updatedAt: now };
    this.assets.set(asset.id, asset);
    return asset;
  }
  async update(id: string, patch: Partial<Omit<Asset, "id" | "createdAt" | "updatedAt">>) {
    const current = this.assets.get(id);
    if (!current) throw new Error("asset not found");
    const next = { ...current, ...patch, updatedAt: new Date() };
    this.assets.set(id, next);
    return next;
  }
}
