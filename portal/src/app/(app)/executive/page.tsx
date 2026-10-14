import { prisma } from "@/lib/db/client";
import { formatBangkok } from "@/lib/format";
import { getExecutiveSummary } from "@/lib/reporting/executive-summary";
import { getServices } from "@/lib/server/context";
import { requirePageSession } from "@/lib/server/session";

const SEVERITY_NAMES = { P1: "วิกฤต", P2: "สูง", P3: "ปานกลาง", P4: "ต่ำ" } as const;
const STATE_TEXT = { fresh: "เป็นปัจจุบัน", stale: "ไม่เป็นปัจจุบัน", error: "ดึงข้อมูลไม่สำเร็จ", unavailable: "ยังไม่มีข้อมูล", missing: "ยังไม่มีข้อมูล" };

// Built from a server-side, count-only view model: nothing restricted reaches this page.
export default async function ExecutivePage() {
  const session = await requirePageSession("executive.read");
  const services = getServices();
  const s = await getExecutiveSummary(session.user, { db: prisma, pollIntervalSeconds: services.config.wazuh.pollIntervalSeconds, services });
  const sources = s.monitoring.sourcesHealthy + s.monitoring.sourcesStale + s.monitoring.sourcesUnknown;

  return (
    <>
      <h1>รายงานผู้บริหาร</h1>
      <p className="muted">
        ตั้งแต่ {formatBangkok(s.period.start)} ถึง {formatBangkok(s.period.end)}
      </p>

      <div className="card">
        <h2>เรื่องที่ควรติดตาม</h2>
        {s.attention.length === 0 ? (
          <p className="state-ok">ไม่มีเรื่องที่ต้องติดตามจากข้อมูลที่มี</p>
        ) : (
          <ul>{s.attention.map((a) => <li key={a}>{a}</li>)}</ul>
        )}
        <p className="muted">ข้อมูลที่ขาดหายหรือไม่ทราบสถานะไม่ได้หมายความว่าปลอดภัย</p>
      </div>

      <div className="card table-wrap">
        <h2>Incident</h2>
        <table>
          <thead>
            <tr><th>ระดับ</th><th>ยังไม่ปิด</th><th>เกิดขึ้นเดือนนี้</th></tr>
          </thead>
          <tbody>
            {(["P1", "P2", "P3", "P4"] as const).map((sev) => (
              <tr key={sev}>
                <td><span className={`badge ${sev}`}>{sev}</span> {SEVERITY_NAMES[sev]}</td>
                <td>{s.incidents.open[sev]}</td>
                <td>{s.incidents.openedThisPeriod[sev]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>ปิดแล้วเดือนนี้ {s.incidents.closedThisPeriod} รายการ</p>
        <p>
          รับทราบภายในเวลาที่กำหนด:{" "}
          {s.incidents.acknowledgedOnTimePercent === null ? "ยังไม่มีรายการที่ถึงกำหนด" : `${s.incidents.acknowledgedOnTimePercent}%`}
          {s.incidents.acknowledgementsBreached > 0 && <span className="state-bad"> (เกินกำหนด {s.incidents.acknowledgementsBreached} รายการ)</span>}
        </p>
      </div>

      <div className="card">
        <h2>การเฝ้าระวัง</h2>
        <p>
          แหล่ง Log ทั้งหมด {sources} แหล่ง: ปกติ {s.monitoring.sourcesHealthy}, ขาดหาย{" "}
          <span className={s.monitoring.sourcesStale ? "state-bad" : undefined}>{s.monitoring.sourcesStale}</span>, ไม่ทราบสถานะ{" "}
          <span className={s.monitoring.sourcesUnknown ? "state-warn" : undefined}>{s.monitoring.sourcesUnknown}</span>
        </p>
        <p>
          การแจ้งเตือนที่ส่งไม่สำเร็จ:{" "}
          <span className={s.monitoring.notificationFailures ? "state-bad" : "state-ok"}>{s.monitoring.notificationFailures}</span>
        </p>
      </div>

      <div className="card">
        <h2>Backup</h2>
        <p>
          งานที่ติดตาม {s.backups.jobs} งาน: ปกติ {s.backups.ok}, ต้องตรวจสอบ{" "}
          <span className={s.backups.needsAttention ? "state-bad" : undefined}>{s.backups.needsAttention}</span>, ยืนยันกู้คืนได้{" "}
          <span className={s.backups.recoveryVerified < s.backups.jobs ? "state-warn" : "state-ok"}>{s.backups.recoveryVerified}</span>
        </p>
      </div>

      <div className="card">
        <h2>พอร์ตและการเชื่อมต่อ</h2>
        <p>ผลสแกนจากภายนอก: {STATE_TEXT[s.ports.scanStatus]}</p>
        <p>
          พอร์ตเปิดโดยไม่ได้รับอนุมัติ <span className={s.ports.unapprovedExposures ? "state-bad" : undefined}>{s.ports.unapprovedExposures}</span>{" "}
          (ความเสี่ยงสูง {s.ports.highRiskExposures}) · เชื่อมต่อออกไปยังพอร์ตที่ห้าม {s.ports.restrictedEgressPorts} พอร์ต
        </p>
      </div>

      <div className="card">
        <h2>เว็บไซต์ (Cloudflare, ข้อมูลสุ่มตัวอย่าง)</h2>
        <p>
          สถานะข้อมูล: {STATE_TEXT[s.web.state]}
          {s.web.events !== null && ` · เหตุการณ์ที่สุ่มได้ 24 ชม. ${s.web.events.toLocaleString("th-TH")} (ถูกบล็อก ${s.web.blocked ?? 0})`}
        </p>
      </div>

      <div className="card">
        <h2>Duo (ตรวจด้วยมือ)</h2>
        <p>
          ตรวจล่าสุด {formatBangkok(s.duo.lastCheckedAt)}
          {s.duo.overdue ? <span className="state-bad"> · เลยกำหนดตรวจ</span> : <span className="state-ok"> · ตามรอบ</span>}
          {s.duo.issuesFound && <span className="state-warn"> · พบสิ่งที่ต้องติดตาม</span>}
        </p>
      </div>
    </>
  );
}
