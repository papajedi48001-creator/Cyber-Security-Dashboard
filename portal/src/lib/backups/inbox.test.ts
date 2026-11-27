import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_EVIDENCE_FILE_BYTES, processEvidenceInbox } from "./inbox";

let dir: string;
const imported: { csv: string; source: string }[] = [];
const importer = async (csv: string, source: string) => {
  imported.push({ csv, source });
  return { imported: csv.split("\n").filter((l) => l && !l.startsWith("job,")).length, rejected: [] };
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "inbox-"));
  imported.length = 0;
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("backup evidence inbox", () => {
  it("imports CSV files and moves them to processed/", async () => {
    await writeFile(join(dir, "wazuh-20261126T183000Z.csv"), "job,result\na,SUCCESS\nb,SUCCESS\n");
    const result = await processEvidenceInbox(dir, importer);
    expect(result).toEqual({ files: 1, imported: 2, rejected: 0, oversized: 0 });
    expect(imported[0]!.source).toBe("wazuh-20261126T183000Z.csv");
    expect(await readdir(dir)).toEqual(["processed"]);
    expect(await readFile(join(dir, "processed", "wazuh-20261126T183000Z.csv"), "utf8")).toContain("a,SUCCESS");
  });

  it("leaves partial (dot) files and non-CSV files alone", async () => {
    await writeFile(join(dir, ".wazuh.csv.Xa1b2"), "partial");
    await writeFile(join(dir, "notes.txt"), "x");
    await mkdir(join(dir, "sub.csv"));
    expect(await processEvidenceInbox(dir, importer)).toEqual({ files: 0, imported: 0, rejected: 0, oversized: 0 });
    expect(imported).toEqual([]);
  });

  it("moves oversized files to rejected/ without importing", async () => {
    await writeFile(join(dir, "big.csv"), "x".repeat(MAX_EVIDENCE_FILE_BYTES + 1));
    expect(await processEvidenceInbox(dir, importer)).toMatchObject({ files: 1, oversized: 1, imported: 0 });
    expect(await readdir(join(dir, "rejected"))).toEqual(["big.csv"]);
  });

  it("keeps a file in place when the import itself fails, so it is retried", async () => {
    await writeFile(join(dir, "a.csv"), "job\n");
    await expect(processEvidenceInbox(dir, async () => Promise.reject(new Error("db down")))).rejects.toThrow("db down");
    expect(await readdir(dir)).toContain("a.csv");
  });

  it("reports a missing inbox directory as an error, not as zero files", async () => {
    await expect(processEvidenceInbox(join(dir, "missing"), importer)).rejects.toThrow();
  });
});
