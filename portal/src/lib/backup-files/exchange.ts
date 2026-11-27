// File exchange with the GDCC store job (ADR 0011). The Portal only reads the
// status file that `hosxp_offsite.py sync` fetched and writes destroy
// instructions into an outbox that sync pushes; it never connects to GDCC itself.

import { mkdir, readFile, rename, stat, writeFile, chmod } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseNasStatus, type NasStatus } from "./nas";
import type { DestroyInstruction } from "./service";
import { parseFilesStatus, type FilesStatus } from "./status";

export const MAX_STATUS_BYTES = 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function readFilesStatus(path: string): Promise<FilesStatus | null> {
  try {
    if ((await stat(path)).size > MAX_STATUS_BYTES) return null;
    return parseFilesStatus(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

/** sync stores the NAS retention status beside the GDCC status. */
export const nasStatusPath = (statusPath: string) => join(dirname(statusPath), "nas-status.json");

export async function readNasStatus(statusPath: string): Promise<NasStatus | null> {
  const path = nasStatusPath(statusPath);
  try {
    if ((await stat(path)).size > MAX_STATUS_BYTES) return null;
    return parseNasStatus(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

export async function writeDestroyInstruction(dir: string, instruction: DestroyInstruction): Promise<void> {
  if (!ID.test(instruction.id)) throw new Error("invalid request id");
  await mkdir(dir, { recursive: true, mode: 0o750 });
  const temp = join(dir, `.${instruction.id}.json.tmp`);
  await writeFile(temp, JSON.stringify(instruction) + "\n", { mode: 0o640 });
  await chmod(temp, 0o640);
  await rename(temp, join(dir, `${instruction.id}.json`));
}
