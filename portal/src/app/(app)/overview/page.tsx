import Link from "next/link";
import { prisma } from "@/lib/db/client";
import { formatBangkok } from "@/lib/format";
import { SLA_LABELS } from "@/lib/incidents/labels";
import { slaState } from "@/lib/incidents/sla";
import { STATUS_LABELS } from "@/lib/incidents/service";
import { buildTiles, type ModuleHealth, type ModuleSummary } from "@/lib/modules/overview";
import { visibleModules, type ModuleId } from "@/lib/modules/registry";
import {
  assetsSummary,
  cloudBackupSummary,
  duoSummary,
  executiveSummaryTile,
  incidentsSummary,
  logSourcesSummary,
  portExposureSummary,
  wafSummary,
} from "@/lib/modules/summaries";
import { loadSummary } from "@/lib/reporting/incident-summary";
import { getServices } from "@/lib/server/context";
import { requirePageSession } from "@/lib/server/session";
import { getSourceOverview } from "@/lib/sources";

const HEALTH_LABELS: Record<ModuleHealth, string> = {
  ok: "ปกติ",
  warn: "ควรตรวจสอบ",
  bad: "ผิดปกติ",
  stale: "ข้อมูลเก่า",
  waiting: "รอข้อมูล",
};

export default async function OverviewPage() {
  const session = await requirePageSession("incident.read");
  const { config, incidents, notifier, backups, ports, waf, duo } = getServices();
  const now = new Date();
  const [portSnap, wafData, duoStatus, open, sources, failures, backupStatus, assetTotal, assetCritical] = await Promise.all([
    ports.getSnapshot(session.user),
    waf.getSampledWafSummary(session.user),
    duo.getStatus(session.user),
    incidents.listIncidents(session.user, { view: "open" }),
    getSourceOverview(prisma, session.user, config.wazuh.pollIntervalSeconds, now),
    notifier.openFailures(),
    backups.listBackupStatus(session.user),
    prisma.asset.count(),
    prisma.asset.count({ where: { critical: true } }),
  ]);
  const summary = await loadSummary(prisma, sources.sources, now);
  const attention = open.filter((i) => ["breached", "due_soon"].includes(slaState(i, now)));

  const summaries: Partial<Record<ModuleId, ModuleSummary>> = {
    incidents: incidentsSummary(summary.open, attention.length),
    assets: assetsSummary(assetTotal, assetCritical),
    "log-sources": logSourcesSummary(sources),
    "cloud-backup": cloudBackupSummary(backupStatus),
    "port-exposure": portExposureSummary(portSnap),
    "cloudflare-waf": wafSummary(wafData),
    "duo-mfa": duoSummary(duoStatus),
    "executive-report": executiveSummaryTile,
  };
  const tiles = buildTiles(visibleModules(session.user.role, {}), summaries, now);
  const counts = tiles.reduce<Record<ModuleHealth, number>>(
    (acc, t) => ({ ...acc, [t.health]: acc[t.health] + 1 }),
    { ok: 0, warn: 0, bad: 0, stale: 0, waiting: 0 },
  );

  return (
    <>
      <div className="page-head">
        <h1>ภาพรวม</h1>
        <p className="muted">
          {(["bad", "warn", "stale", "waiting", "ok"] as const)
            .filter((h) => counts[h] > 0)
            .map((h) => `${HEALTH_LABELS[h]} ${counts[h]}`)
            .join(" · ")}{" "}
          · ณ {formatBangkok(now)}
        </p>
      </div>

      <div className="tiles">
        {tiles.map((t) => (
          <Link key={t.id} href={t.href} className={`tile health-${t.health}`}>
            <span className="tile-head">
              <span className="tile-name">{t.name}</span>
              <span className={`pill health-${t.health}`}>{HEALTH_LABELS[t.health]}</span>
            </span>
            <span className="tile-headline">{t.headline}</span>
            {t.detail && <span className="tile-detail">{t.detail}</span>}
            {t.asOf && <span className="tile-asof">ข้อมูลล่าสุด {formatBangkok(t.asOf)}</span>}
          </Link>
        ))}
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
        <p className="muted">
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
