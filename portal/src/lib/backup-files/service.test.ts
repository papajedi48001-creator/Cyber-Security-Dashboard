import { beforeEach, describe, expect, it } from "vitest";
import { createAuditLog, InMemoryAuditStore } from "../audit";
import { ForbiddenError } from "../auth/authorize";
import { BackupFileRequestError, createBackupFileService, DELETION_HOLD_HOURS, InMemoryBackupFileRequestStore, type DestroyInstruction } from "./service";
import { evaluateFilesStatus, parseFilesStatus } from "./status";

const GIB = 1024 ** 3;
const start = new Date("2026-11-27T04:00:00Z");
const OLD = "MySQL_backup_a_20261123000103.ZIP";

const opA = { id: "u-opa", username: "opa", role: "SECURITY_OPERATOR" as const };
const opB = { id: "u-opb", username: "opb", role: "SECURITY_OPERATOR" as const };
const admin = { id: "u-admin", username: "admin", role: "SECURITY_ADMINISTRATOR" as const };
const viewer = { id: "u-exec", username: "exec", role: "EXECUTIVE_VIEWER" as const };

function statusText(at: Date, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    schema: 1,
    generated_at: at.toISOString().replace(/\.\d{3}Z$/, "Z"),
    volume: { total_bytes: 440 * GIB, used_bytes: 300 * GIB, free_bytes: 140 * GIB },
    max_use_percent: 85,
    keep_min: 2,
    files: [
      { name: "MySQL_backup_a_20261127000103.ZIP", size_bytes: 35 * GIB, modified_at: "2026-11-26T22:30:00Z", checksum: "verified" },
      { name: "MySQL_backup_a_20261126000103.ZIP", size_bytes: 35 * GIB, modified_at: "2026-11-25T22:30:00Z", checksum: "verified" },
      { name: OLD, size_bytes: 34 * GIB, modified_at: "2026-11-22T22:30:00Z", checksum: "verified" },
    ],
    inbox_pending: 0,
    pruned: [],
    corrupt: [],
    requests: [],
    ...overrides,
  });
}

describe("Backup File Management requests", () => {
  let now: Date;
  let store: InMemoryBackupFileRequestStore;
  let auditStore: InMemoryAuditStore;
  let sent: DestroyInstruction[];
  let service: ReturnType<typeof createBackupFileService>;
  const view = (overrides: Record<string, unknown> = {}) => evaluateFilesStatus(parseFilesStatus(statusText(now, overrides)), now);

  beforeEach(() => {
    now = start;
    store = new InMemoryBackupFileRequestStore();
    auditStore = new InMemoryAuditStore();
    sent = [];
    service = createBackupFileService({ store, audit: createAuditLog(auditStore), enabled: true, clock: () => now });
  });

  const propose = (actor: { id: string; username: string; role: "SECURITY_OPERATOR" | "SECURITY_ADMINISTRATOR" } = opA, fileName = OLD, reason = "พื้นที่ใกล้เต็ม ไม่ต้องใช้ไฟล์วันที่ 23 แล้ว") =>
    service.propose(actor, { fileName, reason }, view(), "c1");

  it("records a proposal with the file's size and an audit entry", async () => {
    const request = await propose();
    expect(request).toMatchObject({ fileName: OLD, sizeBytes: 34 * GIB, status: "PROPOSED", proposedByLabel: "opa" });
    expect(auditStore.records.at(-1)).toMatchObject({ action: "backup_file.destroy_proposed", targetType: "BackupLifecycleRequest" });
  });

  it("is off unless the requests outbox is configured", async () => {
    const off = createBackupFileService({ store, audit: createAuditLog(auditStore), enabled: false, clock: () => now });
    await expect(off.propose(opA, { fileName: OLD, reason: "พื้นที่ใกล้เต็มแล้วครับ" }, view(), "c")).rejects.toThrow(BackupFileRequestError);
  });

  it("refuses the newest backups, unknown files and a stale status", async () => {
    await expect(propose(opA, "MySQL_backup_a_20261126000103.ZIP")).rejects.toThrow("ไฟล์ล่าสุด");
    await expect(propose(opA, "MySQL_backup_a_20261101000103.ZIP")).rejects.toThrow("ไม่พบไฟล์");
    const old = new Date(now.getTime() - 3_600_000);
    await expect(
      service.propose(opA, { fileName: OLD, reason: "พื้นที่ใกล้เต็มแล้วครับ" }, evaluateFilesStatus(parseFilesStatus(statusText(old)), now), "c"),
    ).rejects.toThrow("ไม่เป็นปัจจุบัน");
  });

  it("needs a reason and allows one open request per file", async () => {
    await expect(propose(opA, OLD, "ลบ")).rejects.toThrow("เหตุผล");
    await expect(propose(opA, OLD, "เลขบัตร 1234567890123 ต้องลบ")).rejects.toThrow("เหตุผล");
    await propose();
    await expect(propose(opB)).rejects.toThrow("มีคำขอ");
  });

  it("offers requests only: no immediate delete, restore or backup command", () => {
    expect(Object.keys(service).filter((k) => /delete|remove|restore|run|backup/i.test(k))).toEqual([]);
  });

  it("keeps Executive Viewers out", async () => {
    await expect(propose(viewer as never)).rejects.toThrow(ForbiddenError);
    await expect(service.list(viewer)).rejects.toThrow(ForbiddenError);
  });

  it("needs a Security Administrator other than the proposer to approve, then starts the hold", async () => {
    const request = await propose(admin);
    await expect(service.approve(opB, request.id, "", "c")).rejects.toThrow(ForbiddenError);
    await expect(service.approve(admin, request.id, "", "c")).rejects.toThrow("ผู้เสนอ");
    const admin2 = { ...admin, id: "u-admin2", username: "admin2" };
    const approved = await service.approve(admin2, request.id, "ตรวจแล้ว", "c");
    expect(approved.status).toBe("APPROVED");
    expect(approved.holdUntil!.getTime() - now.getTime()).toBe(DELETION_HOLD_HOURS * 3_600_000);
  });

  it("can be rejected, or cancelled during the hold", async () => {
    const a = await propose();
    expect((await service.reject(admin, a.id, "ยังต้องใช้", "c")).status).toBe("REJECTED");
    const b = await propose();
    await service.approve(admin, b.id, "", "c");
    await expect(service.cancel(opB, b.id, "", "c")).rejects.toThrow(ForbiddenError);
    expect((await service.cancel(opA, b.id, "เปลี่ยนใจ", "c")).status).toBe("CANCELLED");
  });

  it("sends a destroy instruction only after the hold, and the cancelled ones never", async () => {
    const keep = await propose();
    await service.approve(admin, keep.id, "", "c");
    await service.exportDue(async (i) => void sent.push(i), "c");
    expect(sent).toEqual([]);
    now = new Date(start.getTime() + DELETION_HOLD_HOURS * 3_600_000);
    await service.exportDue(async (i) => void sent.push(i), "c");
    expect(sent).toEqual([{ id: keep.id, action: "destroy", file: OLD, size_bytes: 34 * GIB, not_before: "2026-11-28T04:00:00Z" }]);
    expect((await store.findById(keep.id))!.status).toBe("SENT");
    await service.exportDue(async (i) => void sent.push(i), "c");
    expect(sent).toHaveLength(1);
  });

  it("records what GDCC did with each sent request", async () => {
    const a = await propose();
    await service.approve(admin, a.id, "", "c");
    now = new Date(start.getTime() + 25 * 3_600_000);
    await service.exportDue(async () => {}, "c");
    const at = now.toISOString().replace(/\.\d{3}Z$/, "Z");
    await service.reconcile(view({ requests: [{ id: a.id, file: OLD, outcome: "destroyed", at }] }), "c");
    expect(await store.findById(a.id)).toMatchObject({ status: "DESTROYED", outcome: "destroyed" });
    expect(auditStore.records.at(-1)).toMatchObject({ action: "backup_file.destroyed", actorLabel: "system:gdcc-files" });
  });

  it("marks a refused request as failed", async () => {
    const a = await propose();
    await service.approve(admin, a.id, "", "c");
    now = new Date(start.getTime() + 25 * 3_600_000);
    await service.exportDue(async () => {}, "c");
    const at = now.toISOString().replace(/\.\d{3}Z$/, "Z");
    await service.reconcile(view({ requests: [{ id: a.id, file: OLD, outcome: "protected", at }] }), "c");
    expect(await store.findById(a.id)).toMatchObject({ status: "FAILED", outcome: "protected" });
  });

  it("closes an open request when the file was pruned automatically first", async () => {
    const a = await propose();
    const files = JSON.parse(statusText(now)).files.slice(0, 2);
    await service.reconcile(view({ files }), "c");
    expect(await store.findById(a.id)).toMatchObject({ status: "CANCELLED" });
  });

  it("does not reconcile from a stale status", async () => {
    const a = await propose();
    now = new Date(start.getTime() + 2 * 3_600_000);
    const stale = evaluateFilesStatus(parseFilesStatus(statusText(start, { files: [] })), now);
    await service.reconcile(stale, "c");
    expect((await store.findById(a.id))!.status).toBe("PROPOSED");
  });
});
