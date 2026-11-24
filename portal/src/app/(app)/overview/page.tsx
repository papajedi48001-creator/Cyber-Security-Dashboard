import Link from "next/link";
import { prisma } from "@/lib/db/client";
import { can } from "@/lib/auth/authorize";
import { formatBangkok } from "@/lib/format";
import { SLA_LABELS } from "@/lib/incidents/labels";
import { slaState } from "@/lib/incidents/sla";
import { STATUS_LABELS } from "@/lib/incidents/service";
import { visibleModules, type ModuleId } from "@/lib/modules/registry";
import {
  backupTile,
  duoTile,
  HEALTH_LABELS,
  incidentTile,
  logSourceTile,
  portTile,
  replicaTile,
  wafTile,
  type ModuleSummary,
} from "@/lib/modules/summary";
import { loadSummary } from "@/lib/reporting/incident-summary";
import { getServices } from "@/lib/server/context";
import { requirePageSession } from "@/lib/server/session";
import { getSourceOverview } from "@/lib/sources";

export default async function OverviewPage() {
  const session = await requirePageSession("incident.read");
  const { config, incidents, notifier, backups, ports, waf, duo, modules } = getServices();
  const now = new Date();
  const shown = visibleModules(session.user.role, await modules.settings()).filter((m) => can(session.user, m.routePermission));
  const [portSnap, wafSummary, duoStatus] = await Promise.all([
    ports.getSnapshot(session.user),
    waf.getSampledWafSummary(session.user),
    duo.getStatus(session.user),
  ]);
  const openExposures = portSnap.exposures.filter((f) => f.classification === "UNAPPROVED" || f.classification === "EXCEPTION_EXPIRED");
  const [open, sources, failures, backupStatus] = await Promise.all([
    incidents.listIncidents(session.user, { view: "open" }),
    getSourceOverview(prisma, session.user, config.wazuh.pollIntervalSeconds, now),
    notifier.openFailures(),
    backups.listBackupStatus(session.user),
  ]);
  const summary = await loadSummary(prisma, sources.sources, now);
  const attention = open.filter((i) => ["breached", "due_soon"].includes(slaState(i, now)));

  const tiles: Partial<Record<ModuleId, ModuleSummary>> = {
    incidents: incidentTile({ open: summary.open, attention: attention.length }),
    "log-sources": logSourceTile({
      connector: { ...sources.connector, lastSuccessAt: sources.connector.lastSuccessAt },
      total: sources.sources.length,
      unhealthy: sources.sources.filter((s) => s.status !== "healthy").length,
    }),
    "cloud-backup": backupTile({
      jobs: backupStatus.length,
      problems: backupStatus.filter((b) => b.health !== "ok").length,
      unverified: backupStatus.filter((b) => b.recovery !== "verified").length,
    }),
    "db-replica": replicaTile(),
    "port-exposure": portTile({ scan: portSnap.scan, unapproved: openExposures.length }),
    "cloud-waf": wafTile(wafSummary),
    duo: duoTile({ state: duoStatus.state, lastAt: duoStatus.last?.checkedAt ?? null }),
  };

  return (
    <>
      <h1>ภาพรวม</h1>
      <div className="tiles">
        {shown.map((m) => {
          const tile = tiles[m.id];
          if (!tile) return null;
          return (
            <Link key={m.id} href={m.href} className="tile">
              <span className="t-head">
                {m.name}
                <span className={`pill ${tile.health}`}>{HEALTH_LABELS[tile.health]}</span>
              </span>
              <span className="t-val">{tile.headline}</span>
              <span className="t-detail">{tile.detail}</span>
              {tile.asOf && tile.health !== "ok" && <span className="t-detail">ข้อมูลล่าสุด {formatBangkok(tile.asOf)}</span>}
            </Link>
          );
        })}
      </div>

      <div className="card table-wrap">
        <h2>ต้องดำเนินการ (SLA ใกล้ครบหรือเกิน)</h2>
        <table>
          <tbody>
            {attention.map((i) => {
              const sla = SLA_LABELS[slaState(i, now)];
              return (
                <tr key={i.id}>
                  <td><Link href={`/incidents/${i.id}`}>{i.number}</Link></td>
                  <td><span className={`badge ${i.severity}`}>{i.severity}</span></td>
                  <td>{STATUS_LABELS[i.status]}</td>
                  <td className={sla.className}>{sla.text} ({formatBangkok(i.acknowledgeDue)})</td>
                </tr>
              );
            })}
            {attention.length === 0 && (
              <tr><td className="muted">ไม่มี incident ที่ใกล้ครบหรือเกิน SLA</td></tr>
            )}
          </tbody>
        </table>
        <p className="muted small">
          เดือนนี้: เปิดใหม่ {Object.values(summary.openedThisPeriod).reduce((a, b) => a + b, 0)} ปิดแล้ว {summary.closedThisPeriod}{" "}
          รับทราบทัน SLA {summary.acknowledgedOnTimeRate === null ? "-" : `${Math.round(summary.acknowledgedOnTimeRate * 100)}%`}
        </p>
      </div>

      <div className="card">
        <h2>การแจ้งเตือน</h2>
        {notifier.channelsConfigured.length === 0 ? (
          <p className="state-bad">ยังไม่ได้ตั้งค่าช่องทางแจ้งเตือน</p>
        ) : failures.length > 0 ? (
          <p className="state-bad">
            ส่งไม่สำเร็จ {failures.length} รายการ <Link href="/incidents">ดูรายละเอียด</Link>
          </p>
        ) : (
          <p className="state-ok">ช่องทาง {notifier.channelsConfigured.join(", ")} ปกติ</p>
        )}
      </div>
    </>
  );
}
