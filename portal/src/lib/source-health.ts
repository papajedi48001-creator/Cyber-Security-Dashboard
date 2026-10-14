// Log Source Health: missing or stale data is reported as such, never as healthy.

export interface SourceSnapshot {
  name: string;
  expectedIntervalMinutes: number;
  lastEventAt: Date | null;
}

export interface ConnectorStatus {
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  lastError: string | null;
}

export type SourceHealthStatus = "healthy" | "stale" | "unknown";

export interface SourceHealth {
  name: string;
  status: SourceHealthStatus;
  lastEventAt: Date | null;
  silentMinutes: number | null;
  reason: string;
}

const STALE_AFTER_POLLS = 3;

export function connectorFreshness(connector: ConnectorStatus, now: Date, pollIntervalSeconds: number) {
  if (!connector.lastSuccessAt)
    return { status: "stale" as const, reason: "ยังไม่เคยดึงข้อมูลจาก Wazuh สำเร็จ", lastError: connector.lastError };
  const ageMs = now.getTime() - connector.lastSuccessAt.getTime();
  if (ageMs > STALE_AFTER_POLLS * pollIntervalSeconds * 1000)
    return {
      status: "stale" as const,
      reason: `ดึงข้อมูลจาก Wazuh สำเร็จล่าสุด ${Math.floor(ageMs / 60_000)} นาทีที่แล้ว`,
      lastError: connector.lastError,
    };
  return { status: "fresh" as const, reason: "ดึงข้อมูลจาก Wazuh ปกติ", lastError: connector.lastError };
}

export function evaluateSourceHealth(
  source: SourceSnapshot,
  now: Date,
  connector: ConnectorStatus,
  pollIntervalSeconds: number,
): SourceHealth {
  const base = { name: source.name, lastEventAt: source.lastEventAt };
  const freshness = connectorFreshness(connector, now, pollIntervalSeconds);
  const silentMinutes = source.lastEventAt ? Math.floor((now.getTime() - source.lastEventAt.getTime()) / 60_000) : null;
  if (freshness.status === "stale")
    return { ...base, status: "unknown", silentMinutes, reason: `ไม่ทราบสถานะ: ${freshness.reason}` };
  if (!source.lastEventAt) return { ...base, status: "unknown", silentMinutes, reason: "ยังไม่เคยได้รับข้อมูลจากแหล่งนี้" };
  if (silentMinutes! > source.expectedIntervalMinutes)
    return { ...base, status: "stale", silentMinutes, reason: `ไม่มีข้อมูลมา ${silentMinutes} นาที (เกณฑ์ ${source.expectedIntervalMinutes} นาที)` };
  return { ...base, status: "healthy", silentMinutes, reason: "ได้รับข้อมูลตามเกณฑ์" };
}

export interface SilentSource {
  name: string;
  critical: boolean;
  reason: string;
  since: Date;
}

/**
 * Sources that need a source-health incident. When the Wazuh connector itself
 * is stale every source is unknown, so only the connector is reported. Sources
 * that have never sent data are not onboarded yet and are left to the Sources page.
 */
export function findSilentSources(
  sources: (SourceSnapshot & { critical: boolean })[],
  connector: ConnectorStatus,
  connectorName: string,
  now: Date,
  pollIntervalSeconds: number,
): SilentSource[] {
  const freshness = connectorFreshness(connector, now, pollIntervalSeconds);
  if (freshness.status === "stale")
    return [{ name: connectorName, critical: true, reason: freshness.reason, since: connector.lastSuccessAt ?? now }];
  return sources.flatMap((source) => {
    const health = evaluateSourceHealth(source, now, connector, pollIntervalSeconds);
    return health.status === "stale"
      ? [{ name: source.name, critical: source.critical, reason: health.reason, since: source.lastEventAt! }]
      : [];
  });
}
