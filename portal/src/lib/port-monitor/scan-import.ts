// Parses the External Exposure Scan summary (infrastructure/external-scan) and
// the Sophos WAN/NAT rule export. Both are summaries: no banners, payloads or
// internal addresses are accepted.

import { isIP } from "node:net";
import { ipInNetworks } from "../net";
import type { Protocol } from "./policy";

export const SCAN_FORMAT = "external-exposure-scan/v1";
const MAX_FINDINGS = 5000;
const PRIVATE = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "169.254.0.0/16", "100.64.0.0/10"];

export class ScanImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScanImportError";
  }
}

export interface ExposureScan {
  scanner: string;
  startedAt: Date;
  finishedAt: Date;
  targets: string[];
  findings: { address: string; port: number; protocol: Protocol; service: string | null }[];
}

export interface FirewallExposureRule {
  ruleName: string;
  address: string;
  port: number;
  protocol: Protocol;
}

function publicAddress(value: unknown, where: string): string {
  const address = typeof value === "string" ? value.trim() : "";
  if (!isIP(address)) throw new ScanImportError(`${where}: address ไม่ถูกต้อง`);
  if (isIP(address) === 4 && ipInNetworks(address, PRIVATE)) throw new ScanImportError(`${where}: ต้องเป็น public address เท่านั้น`);
  return address;
}

function port(value: unknown, where: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new ScanImportError(`${where}: port ไม่ถูกต้อง`);
  return n;
}

function protocol(value: unknown, where: string): Protocol {
  const p = String(value ?? "").toUpperCase();
  if (p !== "TCP" && p !== "UDP") throw new ScanImportError(`${where}: protocol ต้องเป็น TCP หรือ UDP`);
  return p;
}

function date(value: unknown, where: string): Date {
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new ScanImportError(`${where}: เวลาไม่ถูกต้อง`);
  return d;
}

export function parseExposureScan(text: string, now: Date): ExposureScan {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new ScanImportError("ไฟล์ผลสแกนไม่ใช่ JSON");
  }
  if (data.format !== SCAN_FORMAT) throw new ScanImportError(`format ต้องเป็น ${SCAN_FORMAT}`);
  const startedAt = date(data.startedAt, "startedAt");
  const finishedAt = date(data.finishedAt, "finishedAt");
  if (finishedAt < startedAt || finishedAt > now) throw new ScanImportError("เวลาสแกนไม่สมเหตุสมผล");
  if (!Array.isArray(data.targets) || data.targets.length === 0) throw new ScanImportError("ต้องระบุ targets ที่สแกน");
  const targets = data.targets.map((t, i) => publicAddress(t, `targets[${i}]`));
  if (!Array.isArray(data.findings)) throw new ScanImportError("ต้องมี findings (อาจเป็นรายการว่าง)");
  if (data.findings.length > MAX_FINDINGS) throw new ScanImportError(`findings เกิน ${MAX_FINDINGS} รายการ`);
  const findings = data.findings.map((f: Record<string, unknown>, i) => {
    const where = `findings[${i}]`;
    const address = publicAddress(f.address, where);
    if (!targets.includes(address)) throw new ScanImportError(`${where}: address ไม่อยู่ใน targets`);
    const service = typeof f.service === "string" && /^[A-Za-z0-9._/-]{1,64}$/.test(f.service) ? f.service : null;
    return { address, port: port(f.port, where), protocol: protocol(f.protocol, where), service };
  });
  const scanner = typeof data.scanner === "string" ? data.scanner.slice(0, 64) : "unknown";
  return { scanner, startedAt, finishedAt, targets, findings };
}

/** CSV: rule_name,public_address,port,protocol (header optional). */
export function parseFirewallExposureRules(csv: string): FirewallExposureRule[] {
  const rules: FirewallExposureRule[] = [];
  for (const [index, raw] of csv.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || (index === 0 && /^rule_name\s*,/i.test(line))) continue;
    const where = `บรรทัด ${index + 1}`;
    const [ruleName = "", address, p, proto] = line.split(",").map((c) => c.trim());
    if (!/^[\p{L}\p{N} ._()-]{1,128}$/u.test(ruleName)) throw new ScanImportError(`${where}: ชื่อ rule ไม่ถูกต้อง`);
    rules.push({ ruleName, address: publicAddress(address, where), port: port(p, where), protocol: protocol(proto, where) });
  }
  if (rules.length > MAX_FINDINGS) throw new ScanImportError(`rule เกิน ${MAX_FINDINGS} รายการ`);
  return rules;
}
