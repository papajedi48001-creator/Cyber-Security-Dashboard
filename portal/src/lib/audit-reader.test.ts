import { describe, expect, it } from "vitest";
import { createAuditLog, InMemoryAuditStore } from "./audit";
import { createAuditReader } from "./audit-reader";
import { ForbiddenError } from "./auth/authorize";

const admin = { id: "a", role: "SECURITY_ADMINISTRATOR" as const };
const operator = { id: "o", role: "SECURITY_OPERATOR" as const };

async function seeded(count: number) {
  const store = new InMemoryAuditStore();
  let t = Date.UTC(2026, 10, 1);
  const log = createAuditLog(store, () => new Date((t += 60_000)));
  for (let i = 0; i < count; i++)
    await log.append({ actor: { id: "a", label: "admin" }, action: i % 2 ? "module.disabled" : "auth.login_succeeded", target: { type: "T", id: String(i) }, correlationId: "c" });
  return createAuditReader(store);
}

describe("audit reader", () => {
  it("lists newest first, a page at a time", async () => {
    const reader = await seeded(5);
    const first = await reader.list(admin, { limit: 2 });
    expect(first.records.map((r) => r.targetId)).toEqual(["4", "3"]);
    expect(first.nextBefore).toBeTruthy();
    const second = await reader.list(admin, { limit: 2, before: first.nextBefore! });
    expect(second.records.map((r) => r.targetId)).toEqual(["2", "1"]);
  });

  it("filters by action prefix", async () => {
    const reader = await seeded(4);
    const page = await reader.list(admin, { limit: 10, actionPrefix: "module." });
    expect(page.records.every((r) => r.action.startsWith("module."))).toBe(true);
    expect(page.records).toHaveLength(2);
    expect(page.nextBefore).toBeNull();
  });

  it("is for administrators only", async () => {
    const reader = await seeded(1);
    await expect(reader.list(operator, { limit: 10 })).rejects.toThrow(ForbiddenError);
  });

  it("has no way to change records", async () => {
    const reader = await seeded(1);
    expect(Object.keys(reader)).toEqual(["list"]);
  });
});
