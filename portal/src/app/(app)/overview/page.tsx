import Link from "next/link";
import { prisma } from "@/lib/db/client";
import { formatBangkok } from "@/lib/format";
import { SLA_LABELS } from "@/lib/incidents/labels";
import { slaState } from "@/lib/incidents/sla";
import { STATUS_LABELS } from "@/lib/incidents/service";
import { loadSummary } from "@/lib/reports/summary";
import { getServices } from "@/lib/server/context";
import { requirePageSession } from "@/lib/server/session";
import { getSourceOverview } from "@/lib/sources";

export default async function OverviewPage() {
  const session = await requirePageSession("incident.read");
  const { config, incidents, notifier } = getServices();
  const now = new Date();
  const [open, sources, failures] = await Promise.all([
    incidents.listIncidents(session.user, { view: "open" }),
    getSourceOverview(prisma, session.user, config.wazuh.pollIntervalSeconds, now),
    notifier.openFailures(),
  ]);
  const summary = await loadSummary(prisma, sources.sources, now);
  const attention = open.filter((i) => ["breached", "due_soon"].includes(slaState(i, now)));
  const unhealthy = sources.sources.filter((s) => s.status !== "healthy");

  return (
    <>
      <h1>ภาพรวม</h1>
      <div className="card">
        <h2>Incident ที่ยังไม่ปิด</h2>
        <p>
          {(["P1", "P2", "P3", "P4"] as const).map((s) => (
            <span key={s} style={{ marginRight: 16 }}>
              <span className={`badge ${s}`}>{s}</span> {summary.open[s]}
            </span>
          ))}
        </p>
        <p className="muted">
          เดือนนี้: เปิดใหม่ {Object.values(summary.openedThisPeriod).reduce((a, b) => a + b, 0)} ปิดแล้ว {summary.closedThisPeriod}{" "}
          รับทราบทัน SLA {summary.acknowledgedOnTimeRate === null ? "-" : `${Math.round(summary.acknowledgedOnTimeRate * 100)}%`}
        </p>
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
      </div>

      <div className="card">
        <h2>แหล่ง Log</h2>
        <p className={sources.connector.status === "fresh" ? "state-ok" : "state-bad"}>{sources.connector.reason}</p>
        {unhealthy.length === 0 ? (
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
