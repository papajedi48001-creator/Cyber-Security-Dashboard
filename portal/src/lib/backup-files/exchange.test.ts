import { mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_STATUS_BYTES, nasStatusPath, readFilesStatus, readNasStatus, writeDestroyInstruction } from "./exchange";

describe("GDCC files exchange", () => {
  it("writes each destroy instruction once under its id, never half-written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "outbox-"));
    const instruction = { id: "bfr1", action: "destroy" as const, file: "MySQL_backup_a_20261123000103.ZIP", size_bytes: 3, not_before: "2026-11-28T04:00:00Z" };
    await writeDestroyInstruction(dir, instruction);
    expect(await readdir(dir)).toEqual(["bfr1.json"]);
    expect(JSON.parse(await readFile(join(dir, "bfr1.json"), "utf8"))).toEqual(instruction);
    expect((await stat(join(dir, "bfr1.json"))).mode & 0o777).toBe(0o640);
  });

  it("refuses an id that could leave the outbox", async () => {
    const dir = await mkdtemp(join(tmpdir(), "outbox-"));
    await expect(writeDestroyInstruction(dir, { id: "../x", action: "destroy", file: "a", size_bytes: 1, not_before: "x" })).rejects.toThrow();
  });

  it("reads the fetched status, and returns null when it is missing, too large or invalid", async () => {
    const dir = await mkdtemp(join(tmpdir(), "status-"));
    const path = join(dir, "status.json");
    expect(await readFilesStatus(path)).toBeNull();
    await writeFile(path, "{}");
    expect(await readFilesStatus(path)).toBeNull();
    await writeFile(path, " ".repeat(MAX_STATUS_BYTES + 1));
    expect(await readFilesStatus(path)).toBeNull();
    await writeFile(
      path,
      JSON.stringify({ schema: 1, generated_at: "2026-11-27T03:50:00Z", volume: { total_bytes: 10, used_bytes: 5, free_bytes: 5 }, max_use_percent: 85, keep_min: 2, files: [], inbox_pending: 0, pruned: [], corrupt: [], requests: [] }),
    );
    expect((await readFilesStatus(path))?.keepMin).toBe(2);
  });

  it("reads the NAS status that sync keeps beside the GDCC status", async () => {
    const dir = await mkdtemp(join(tmpdir(), "status-"));
    const status = join(dir, "status.json");
    expect(nasStatusPath(status)).toBe(join(dir, "nas-status.json"));
    expect(await readNasStatus(status)).toBeNull();
    await writeFile(
      nasStatusPath(status),
      JSON.stringify({ schema: 1, generated_at: "2026-11-26T22:10:00Z", keep_count: 15, complete_sets: 0, newest_set_date: null, oldest_set_date: null, sets: [], deleted_files: [], free_bytes: 1, total_bytes: 2, last_run_ok: true, error: null }),
    );
    expect((await readNasStatus(status))?.keep_count).toBe(15);
  });
});
