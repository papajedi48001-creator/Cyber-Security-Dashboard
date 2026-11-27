import Link from "next/link";
import { prisma } from "@/lib/db/client";
import { formatBangkok } from "@/lib/format";
import { SLA_LABELS } from "@/lib/incidents/labels";
import { slaState } from "@/lib/incidents/sla";
import { STATUS_LABELS } from "@/lib/incidents/service";
import { loadSummary } from "@/lib/reporting/incident-summary";
import { getServices } from "@/lib/server/context";
import { requirePageSession } from "@/lib/server/session";
import { getSourceOverview } from "@/lib/sources";
import {
  backupsTriage,
  duoTriage,
  incidentsTriage,
  notificationsTriage,
  portsTriage,
  sourcesTriage,
  TRIAGE_LABELS,
  wafTriage,
  type Triage,
} from "@/lib/ui/triage";

function Tile({ href, name, triage }: { href: string; name: string; triage: Triage }) {
  return (
    <li className={`tile ${triage.level}`}>
      <Link href={href}>{name}</Link>
      <span className="level">{TRIAGE_LABELS[triage.level]}</span>
      <span className="why">{triage.text}</span>
    </li>
  );
}

export default async function OverviewPage() {
  const session = await requirePageSession("incident.read");
  const { config, incidents, notifier, backups, ports, waf, duo } = getServices();
  const now = new Date();
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
  const backupProblems = backupStatus.filter((b) => b.health !== "ok");
  const unverified = backupStatus.filter((b) => b.recovery !== "verified").length;
  const summary = await loadSummary(prisma, sources.sources, now);
  const attention = open.filter((i) => ["breached", "due_soon"].includes(slaState(i, now)));
  const unhealthy = sources.sources.filter((s) => s.status !== "healthy");

  const board: { href: string; name: string; triage: Triage }[] = [
    { href: "/incidents", name: "Incident", triage: incidentsTriage({ open: summary.open, attention: attention.length }) },
    {
      href: "/sources",
      name: "แหล่ง Log",
      triage: sourcesTriage({ connectorFresh: sources.connector.status === "fresh", statuses: sources.sources.map((s) => s.status) }),
    },
    { href: "/backups", name: "Backup", triage: backupsTriage({ healths: backupStatus.map((b) => b.health), unverified }) },
    { href: "/port-monitor", name: "พอร์ตเปิดสู่ภายนอก", triage: portsTriage({ scanStatus: portSnap.scan.status, openExposures: openExposures.length }) },
    { href: "/web-application-firewall", name: "WAF", triage: wafTriage({ status: wafSummary.status }) },
    { href: "/duo", name: "Duo", triage: duoTriage({ state: duoStatus.state as Parameters<typeof duoTriage>[0]["state"] }) },
    {
      href: "/incidents",
      name: "การแจ้งเตือน",
      triage: notificationsTriage({ channels: notifier.channelsConfigured.length, failures: failures.length }),
    },
  ];
  const order = { act: 0, check: 1, unknown: 2, ok: 3 } as const;
  board.sort((a, b) => order[a.triage.level] - order[b.triage.level]);

  return (
    <>
      <h1>ภาพรวม</h1>
      <p className="lead">ข้อมูล ณ {formatBangkok(now)} เรียงจากเรื่องที่ต้องดำเนินการก่อน ด้านที่ไม่ทราบสถานะแสดงเป็นลายเส้น เพราะข้อมูลขาดหายไม่ได้แปลว่าปกติ</p>
      <ul className="board" aria-label="สถานะแต่ละด้าน">
        {board.map((tile) => (
          <Tile key={tile.name} {...tile} />
        ))}
      </ul>

      <div className="split">
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
        </div>

        <div className="card">
          <h2>Incident ที่ยังไม่ปิด</h2>
          <ul className="counts">
            {(["P1", "P2", "P3", "P4"] as const).map((s) => (
              <li key={s}>
                <span className={`badge ${s}`}>{s}</span> <strong>{summary.open[s]}</strong>
              </li>
            ))}
          </ul>
          <p className="muted">
            เดือนนี้เปิดใหม่ {Object.values(summary.openedThisPeriod).reduce((a, b) => a + b, 0)} ปิดแล้ว {summary.closedThisPeriod} รับทราบทัน SLA{" "}
            {summary.acknowledgedOnTimeRate === null ? "-" : `${Math.round(summary.acknowledgedOnTimeRate * 100)}%`}
          </p>
        </div>
      </div>

      <h2 className="section-title">รายละเอียดแต่ละด้าน</h2>
      <div className="split">
        <div className="card">
          <h2>แหล่ง Log</h2>
          <p className={sources.connector.status === "fresh" ? "state-ok" : "state-bad"}>{sources.connector.reason}</p>
          {sources.sources.length === 0 ? (
            <p className="state-warn">ยังไม่ได้ลงทะเบียนแหล่ง Log จึงยังไม่ทราบสถานะ</p>
          ) : unhealthy.length === 0 ? (
            <p className="state-ok">ทุกแหล่งส่งข้อมูลตามเกณฑ์</p>
          ) : (
            <ul>
              {unhealthy.map((s) => (
                <li key={s.name} className={s.status === "stale" ? "state-bad" : "state-warn"}>
                  {s.name}: {s.reason}
                </li>
              ))}
            </ul>
          )}
          <Link href="/sources">ดูทั้งหมด</Link>
        </div>

        <div className="card">
          <h2>Backup</h2>
          {backupStatus.length === 0 ? (
            <p className="state-warn">ยังไม่มีงาน backup ที่ติดตาม</p>
          ) : backupProblems.length === 0 ? (
            <p className="state-ok">ทุกงานสำรองตามรอบ</p>
          ) : (
            <ul>
              {backupProblems.map((b) => (
                <li key={b.job.id} className="state-bad">
                  {b.job.name}: {b.health === "unknown" ? "ไม่มีข้อมูล" : b.health === "failing" ? `ล้มเหลว ${b.consecutiveFailures} ครั้งติดกัน` : b.health === "stale" ? "ขาดรอบ" : "ไม่ได้เข้ารหัส"}
                </li>
              ))}
            </ul>
          )}
          {unverified > 0 && <p className="state-warn">ยังไม่ยืนยันการกู้คืน {unverified} งาน</p>}
          <Link href="/backups">ดูทั้งหมด</Link>
        </div>

        <div className="card">
          <h2>โมดูลอื่น</h2>
          <ul>
            <li className={portSnap.scan.status === "fresh" && openExposures.length === 0 ? "state-ok" : "state-bad"}>
              <Link href="/port-monitor">พอร์ต</Link>: {portSnap.scan.reason}
              {openExposures.length > 0 && ` · เปิดโดยไม่ได้รับอนุมัติ ${openExposures.length} รายการ`}
            </li>
            <li className={wafSummary.status === "fresh" ? "state-ok" : "state-warn"}>
              <Link href="/web-application-firewall">WAF (sampled)</Link>: {wafSummary.reason}
            </li>
            <li className={duoStatus.state === "current" ? "state-ok" : "state-bad"}>
              <Link href="/duo">Duo (ตรวจด้วยมือ)</Link>:{" "}
              {duoStatus.last ? `ตรวจล่าสุด ${formatBangkok(duoStatus.last.checkedAt)}` : "ยังไม่เคยตรวจ"}
              {duoStatus.state === "overdue" && " · เลยกำหนด"}
            </li>
          </ul>
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
      </div>
    </>
  );
}
