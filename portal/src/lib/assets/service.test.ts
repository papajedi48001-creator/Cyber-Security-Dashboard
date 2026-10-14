import { beforeEach, describe, expect, it } from "vitest";
import { createAuditLog, InMemoryAuditStore } from "../audit";
import { ForbiddenError } from "../auth/authorize";
import { createAssetService, InMemoryAssetStore, AssetValidationError } from "./service";

const admin = { id: "a1", username: "admin", role: "SECURITY_ADMINISTRATOR" as const };
const operator = { id: "o1", username: "op", role: "SECURITY_OPERATOR" as const };
const executive = { id: "e1", username: "exec", role: "EXECUTIVE_VIEWER" as const };

describe("asset service", () => {
  let auditStore: InMemoryAuditStore;
  let service: ReturnType<typeof createAssetService>;

  beforeEach(() => {
    auditStore = new InMemoryAuditStore();
    service = createAssetService({ store: new InMemoryAssetStore(), audit: createAuditLog(auditStore) });
  });

  const base = { name: "hosxp-db", role: "HOSxP database service", owner: "IT infrastructure", critical: false };

  it("lets a Security Administrator create and update assets, with one audit record each", async () => {
    const asset = await service.createAsset(admin, base, "c1");
    await service.updateAsset(admin, asset.id, { owner: "DBA team" }, "c2");
    const listed = await service.listAssets(operator);
    expect(listed[0]?.owner).toBe("DBA team");
    expect(auditStore.records.map((r) => r.action)).toEqual(["asset.created", "asset.updated"]);
  });

  it("requires a reason when marking an asset critical", async () => {
    const asset = await service.createAsset(admin, base, "c1");
    await expect(service.markCriticalAsset(admin, asset.id, "", "c2")).rejects.toBeInstanceOf(AssetValidationError);
    const updated = await service.markCriticalAsset(admin, asset.id, "Stores HIS data", "c3");
    expect(updated.critical).toBe(true);
    expect(updated.criticalReason).toBe("Stores HIS data");
    await expect(service.createAsset(admin, { ...base, name: "x-1", critical: true }, "c4")).rejects.toBeInstanceOf(
      AssetValidationError,
    );
  });

  it("denies changes to Security Operator and Executive Viewer", async () => {
    await expect(service.createAsset(operator, base, "c")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.createAsset(executive, base, "c")).rejects.toBeInstanceOf(ForbiddenError);
    const asset = await service.createAsset(admin, base, "c");
    await expect(service.updateAsset(operator, asset.id, { owner: "x" }, "c")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.markCriticalAsset(operator, asset.id, "r", "c")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("denies asset listing to Executive Viewer", async () => {
    await expect(service.listAssets(executive)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("filters critical assets", async () => {
    await service.createAsset(admin, base, "c");
    await service.createAsset(admin, { ...base, name: "dc01", critical: true, criticalReason: "Domain controller" }, "c");
    expect((await service.listAssets(operator, { critical: true })).map((a) => a.name)).toEqual(["dc01"]);
  });

  it("rejects duplicate names and patient-like data", async () => {
    await service.createAsset(admin, base, "c");
    await expect(service.createAsset(admin, base, "c")).rejects.toBeInstanceOf(AssetValidationError);
    await expect(
      service.createAsset(admin, { ...base, name: "pc-1", owner: "patient 1234567890123" }, "c"),
    ).rejects.toBeInstanceOf(AssetValidationError);
  });
});
