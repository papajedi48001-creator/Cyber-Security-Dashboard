import { beforeEach, describe, expect, it } from "vitest";
import { createAuditLog, InMemoryAuditStore } from "../audit";
import { ForbiddenError } from "../auth/authorize";
import { createDuoManualCheckService, DuoCheckError, InMemoryDuoCheckStore } from "./manual-check";

let now = new Date("2026-10-14T03:00:00Z"); // Wednesday 10:00 Bangkok
const op = { id: "op", username: "op.a", role: "SECURITY_OPERATOR" as const };
const exec = { id: "exec", username: "exec", role: "EXECUTIVE_VIEWER" as const };

let audit: InMemoryAuditStore;
let service: ReturnType<typeof createDuoManualCheckService>;

const input = {
  checkedAt: new Date("2026-10-14T02:30:00Z"),
  authLogReviewed: true,
  adminActionsReviewed: true,
  deniedAuthentications: 3,
  fraudReports: 0,
  bypassUsers: 1,
  note: "Denied attempts from a known roaming user",
};

beforeEach(() => {
  now = new Date("2026-10-14T03:00:00Z");
  audit = new InMemoryAuditStore();
  service = createDuoManualCheckService({ store: new InMemoryDuoCheckStore(), audit: createAuditLog(audit, () => now), clock: () => now });
});

describe("Duo Manual Check", () => {
  it("records who checked and when, and labels the data as manual", async () => {
    const check = await service.recordDuoManualCheck(op, input, "c");
    expect(check).toMatchObject({ checkedById: "op", checkedByName: "op.a", checkedAt: input.checkedAt, issuesFound: true });
    const status = await service.getStatus(op);
    expect(status).toMatchObject({ mode: "manual", state: "current", last: { checkedByName: "op.a" } });
    expect(audit.records[0]).toMatchObject({ action: "duo.manual_check_recorded", actorLabel: "op.a" });
  });

  it("is overdue after the next working day passes without a check", async () => {
    await service.recordDuoManualCheck(op, { ...input, bypassUsers: 0, deniedAuthentications: 0 }, "c");
    now = new Date("2026-10-15T09:31:00Z"); // Thursday 16:31 Bangkok
    expect((await service.getStatus(op)).state).toBe("overdue");
  });

  it("reports never checked rather than healthy", async () => {
    expect(await service.getStatus(op)).toMatchObject({ state: "never_checked", last: null });
  });

  it("requires the checklist to be completed and the time to be real", async () => {
    await expect(service.recordDuoManualCheck(op, { ...input, authLogReviewed: false }, "c")).rejects.toBeInstanceOf(DuoCheckError);
    await expect(service.recordDuoManualCheck(op, { ...input, checkedAt: new Date("2026-10-14T04:00:00Z") }, "c")).rejects.toBeInstanceOf(DuoCheckError);
    await expect(service.recordDuoManualCheck(op, { ...input, fraudReports: -1 }, "c")).rejects.toBeInstanceOf(DuoCheckError);
    await expect(service.recordDuoManualCheck(op, { ...input, note: "user 1234567890123" }, "c")).rejects.toBeInstanceOf(DuoCheckError);
  });

  it("is limited to Security Operators and Administrators", async () => {
    await expect(service.recordDuoManualCheck(exec, input, "c")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.getStatus(exec)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
