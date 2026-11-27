import { describe, expect, it } from "vitest";
import { evaluateFilesStatus, parseFilesStatus, STATUS_STALE_MINUTES } from "./status";

const GIB = 1024 ** 3;
const now = new Date("2026-11-27T04:00:00Z"); // 11:00 Bangkok

function status(overrides: Record<string, unknown> = {}) {
  return {
    schema: 1,
    generated_at: "2026-11-27T03:50:00Z",
    volume: { total_bytes: 440 * GIB, used_bytes: 300 * GIB, free_bytes: 140 * GIB },
    max_use_percent: 85,
    keep_min: 2,
    files: [
      { name: "MySQL_backup_a_20261127000103.ZIP", size_bytes: 35 * GIB, modified_at: "2026-11-26T22:30:00Z", checksum: "verified" },
      { name: "MySQL_backup_a_20261126000103.ZIP", size_bytes: 35 * GIB, modified_at: "2026-11-25T22:30:00Z", checksum: "verified" },
      { name: "MySQL_backup_a_20261124000103.ZIP", size_bytes: 10 * GIB, modified_at: "2026-11-23T22:30:00Z", checksum: "missing" },
      { name: "MySQL_backup_a_20261123000103.ZIP", size_bytes: 34 * GIB, modified_at: "2026-11-22T22:30:00Z", checksum: "verified" },
    ],
    inbox_pending: 0,
    pruned: [{ file: "MySQL_backup_a_20261120000103.ZIP", at: "2026-11-23T03:00:00Z" }],
    corrupt: [],
    requests: [{ id: "r1", file: "MySQL_backup_a_20261121000103.ZIP", outcome: "destroyed", at: "2026-11-24T03:00:00Z" }],
    ...overrides,
  };
}

describe("parseFilesStatus", () => {
  it("accepts the status written by the GDCC store job", () => {
    const parsed = parseFilesStatus(JSON.stringify(status()));
    expect(parsed?.files).toHaveLength(4);
    expect(parsed?.generatedAt.toISOString()).toBe("2026-11-27T03:50:00.000Z");
  });

  it("rejects anything else rather than guessing", () => {
    expect(parseFilesStatus("{not json")).toBeNull();
    expect(parseFilesStatus(JSON.stringify(status({ schema: 2 })))).toBeNull();
    expect(parseFilesStatus(JSON.stringify(status({ files: [{ name: "../etc/passwd", size_bytes: 1, modified_at: "2026-11-26T00:00:00Z", checksum: "verified" }] })))).toBeNull();
    expect(parseFilesStatus(JSON.stringify(status({ generated_at: "yesterday" })))).toBeNull();
  });
});

describe("evaluateFilesStatus", () => {
  it("shows unavailable, never an empty healthy list, when there is no status", () => {
    const view = evaluateFilesStatus(null, now);
    expect(view.state).toBe("unavailable");
    expect(view.files).toEqual([]);
    expect(view.volume).toBeNull();
  });

  it("marks the status stale when the GDCC job has not reported recently", () => {
    const old = new Date(now.getTime() - (STATUS_STALE_MINUTES + 1) * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const view = evaluateFilesStatus(parseFilesStatus(JSON.stringify(status({ generated_at: old }))), now);
    expect(view.state).toBe("stale");
    expect(view.files).toHaveLength(4);
  });

  it("protects the newest backups and flags small files and missing checksums", () => {
    const view = evaluateFilesStatus(parseFilesStatus(JSON.stringify(status())), now);
    expect(view.state).toBe("fresh");
    expect(view.files.map((f) => f.protected)).toEqual([true, true, false, false]);
    expect(view.files.map((f) => f.small)).toEqual([false, false, true, false]);
    expect(view.files[2]!.checksum).toBe("missing");
    expect(view.files[0]!.backupDate).toBe("2026-11-27");
  });

  it("reports volume use against the GDCC expansion and pruning thresholds", () => {
    const at = (usedGib: number) =>
      evaluateFilesStatus(parseFilesStatus(JSON.stringify(status({ volume: { total_bytes: 100 * GIB, used_bytes: usedGib * GIB, free_bytes: (100 - usedGib) * GIB } }))), now).volume!;
    expect(at(60)).toMatchObject({ usedPercent: 60, level: "ok" });
    expect(at(80)).toMatchObject({ usedPercent: 80, level: "expand" });
    expect(at(90)).toMatchObject({ usedPercent: 90, level: "pruning" });
  });

  it("lists days with no backup between the oldest kept file and today", () => {
    const view = evaluateFilesStatus(parseFilesStatus(JSON.stringify(status())), now);
    expect(view.days).toEqual([
      { date: "2026-11-27", state: "present" },
      { date: "2026-11-26", state: "present" },
      { date: "2026-11-25", state: "missing" },
      { date: "2026-11-24", state: "present" },
      { date: "2026-11-23", state: "present" },
    ]);
  });

  it("waits for today's backup instead of calling it missing", () => {
    const files = status().files.slice(1);
    const view = evaluateFilesStatus(parseFilesStatus(JSON.stringify(status({ files }))), now);
    expect(view.days[0]).toEqual({ date: "2026-11-27", state: "pending" });
  });

  it("keeps the recent automatic pruning and request outcomes", () => {
    const view = evaluateFilesStatus(parseFilesStatus(JSON.stringify(status())), now);
    expect(view.pruned[0]!.file).toBe("MySQL_backup_a_20261120000103.ZIP");
    expect(view.outcomes.get("r1")?.outcome).toBe("destroyed");
  });
});
