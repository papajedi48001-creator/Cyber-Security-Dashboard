import { describe, expect, it } from "vitest";
import { createAuditLog, InMemoryAuditStore, UnsafeAuditDataError, type AuditInput } from "./audit";

const NOW = new Date("2026-10-14T03:00:00Z");

function input(overrides: Partial<AuditInput> = {}): AuditInput {
  return {
    actor: { id: "user-1", label: "operator.a" },
    action: "incident.acknowledge",
    target: { type: "Incident", id: "inc-1" },
    metadata: { from: "ASSIGNED", to: "ACKNOWLEDGED" },
    correlationId: "corr-1",
    ...overrides,
  };
}

describe("audit log", () => {
  it("records actor, action, target, UTC time, metadata and correlation id", async () => {
    const store = new InMemoryAuditStore();
    const audit = createAuditLog(store, () => NOW);
    const record = await audit.append(input());
    expect(record).toMatchObject({
      actorId: "user-1",
      actorLabel: "operator.a",
      action: "incident.acknowledge",
      targetType: "Incident",
      targetId: "inc-1",
      metadata: { from: "ASSIGNED", to: "ACKNOWLEDGED" },
      correlationId: "corr-1",
    });
    expect(record.at.toISOString()).toBe("2026-10-14T03:00:00.000Z");
    expect(store.records).toHaveLength(1);
  });

  it("records system actions without a user id", async () => {
    const audit = createAuditLog(new InMemoryAuditStore(), () => NOW);
    const record = await audit.append(input({ actor: { id: null, label: "system:wazuh-poller" } }));
    expect(record.actorId).toBeNull();
  });

  it.each([
    ["password", { password: "x" }],
    ["new password hash", { newPasswordHash: "x" }],
    ["TOTP secret", { totpSecret: "x" }],
    ["session token", { sessionToken: "x" }],
    ["raw log payload", { raw: "x" }],
    ["Wazuh full_log", { full_log: "x" }],
    ["patient name", { patientName: "x" }],
    ["hospital number", { hn: "x" }],
    ["nested secret", { change: { apiSecret: "x" } }],
  ])("rejects metadata containing a %s", async (_label, metadata) => {
    const store = new InMemoryAuditStore();
    const audit = createAuditLog(store, () => NOW);
    await expect(audit.append(input({ metadata }))).rejects.toBeInstanceOf(UnsafeAuditDataError);
    expect(store.records).toHaveLength(0);
  });

  it("rejects values that look like a Thai national ID", async () => {
    const audit = createAuditLog(new InMemoryAuditStore(), () => NOW);
    await expect(audit.append(input({ metadata: { note: "id 1234567890123" } }))).rejects.toBeInstanceOf(
      UnsafeAuditDataError,
    );
  });

  it("rejects oversized metadata values that could hide raw logs", async () => {
    const audit = createAuditLog(new InMemoryAuditStore(), () => NOW);
    await expect(audit.append(input({ metadata: { note: "x".repeat(2001) } }))).rejects.toBeInstanceOf(
      UnsafeAuditDataError,
    );
  });

  it("does not echo the rejected value in the error", async () => {
    const audit = createAuditLog(new InMemoryAuditStore(), () => NOW);
    const error = await audit.append(input({ metadata: { password: "hunter2-secret" } })).catch((e) => e);
    expect(String(error.message)).not.toContain("hunter2-secret");
  });

  it("requires a dotted action name and a correlation id", async () => {
    const audit = createAuditLog(new InMemoryAuditStore(), () => NOW);
    await expect(audit.append(input({ action: "Acknowledge" }))).rejects.toThrow();
    await expect(audit.append(input({ correlationId: "" }))).rejects.toThrow();
  });

  it("keeps stored records immutable", async () => {
    const store = new InMemoryAuditStore();
    const audit = createAuditLog(store, () => NOW);
    const record = await audit.append(input());
    expect(() => {
      (record as { action: string }).action = "changed";
    }).toThrow();
  });
});
