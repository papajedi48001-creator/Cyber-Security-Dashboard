// Backup Evidence inbox (ADR 0009): the GDCC backup wrapper on each host
// delivers CSV files here. The worker imports each file once and moves it to
// processed/ (or rejected/ when too large). Dot-prefixed names are files still
// being written by rsync or the wrapper and are left alone.

import { lstat, mkdir, readdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";

export const MAX_EVIDENCE_FILE_BYTES = 64 * 1024;
const CSV_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.csv$/;

export type EvidenceImporter = (csv: string, source: string) => Promise<{ imported: number; rejected: unknown[] }>;

export async function processEvidenceInbox(dir: string, importer: EvidenceImporter) {
  const summary = { files: 0, imported: 0, rejected: 0, oversized: 0 };
  const names = (await readdir(dir)).filter((n) => CSV_NAME.test(n)).sort();
  for (const name of names) {
    const path = join(dir, name);
    const info = await lstat(path);
    if (!info.isFile()) continue;
    summary.files++;
    if (info.size > MAX_EVIDENCE_FILE_BYTES) {
      await moveTo(dir, "rejected", name);
      summary.oversized++;
      continue;
    }
    const result = await importer(await readFile(path, "utf8"), name);
    summary.imported += result.imported;
    summary.rejected += result.rejected.length;
    await moveTo(dir, "processed", name);
  }
  return summary;
}

async function moveTo(dir: string, sub: "processed" | "rejected", name: string) {
  await mkdir(join(dir, sub), { recursive: true, mode: 0o750 });
  await rename(join(dir, name), join(dir, sub, name));
}
