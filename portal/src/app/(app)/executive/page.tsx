import { prisma } from "@/lib/db/client";
import { formatBangkok } from "@/lib/format";
import { loadSummary } from "@/lib/reports/summary";
import { getServices } from "@/lib/server/context";
import { requirePageSession } from "@/lib/server/session";
import { loadSourceOverview } from "@/lib/sources";

const SEVERITY_NAMES = { P1: "วิกฤต", P2: "สูง", P3: "ปานกลาง", P4: "ต่ำ" } as const;

// Counts only: Executive Viewers never see incident titles, systems, addresses or people.
export default async function ExecutivePage() {
  await requirePageSession("executive.read");
  const { config } = getServices();
  const now = new Date();
  const sources = await loadSourceOverview(prisma, config.wazuh.pollIntervalSeconds, now);
  const s = await loadSummary(prisma, sources.sources.map(({ status }) => ({ status })), now);
  const totalSources = s.sources.healthy + s.sources.stale + s.sources.unknown;

  return (
    <>
      <h1>รายงานผู้บริหาร</h1>
      <p className="muted">
        ตั้งแต่ {formatBangkok(s.periodStart)} ถึง {formatBangkok(now)}
      </p>
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
                <td>{s.open[sev]}</td>
                <td>{s.openedThisPeriod[sev]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>ปิดแล้วเดือนนี้ {s.closedThisPeriod} รายการ</p>
        <p>
          รับทราบภายในเวลาที่กำหนด:{" "}
          {s.acknowledgedOnTimeRate === null ? "ยังไม่มีรายการที่ถึงกำหนด" : `${Math.round(s.acknowledgedOnTimeRate * 100)}%`}
          {s.acknowledgementsBreached > 0 && <span className="state-bad"> (เกินกำหนด {s.acknowledgementsBreached} รายการ)</span>}
        </p>
      </div>
      <div className="card">
        <h2>การเฝ้าระวัง</h2>
        <p>
          แหล่ง Log ทั้งหมด {totalSources} แหล่ง: ปกติ {s.sources.healthy}, ขาดหาย{" "}
          <span className={s.sources.stale ? "state-bad" : undefined}>{s.sources.stale}</span>, ไม่ทราบสถานะ{" "}
          <span className={s.sources.unknown ? "state-warn" : undefined}>{s.sources.unknown}</span>
        </p>
        <p>
          การแจ้งเตือนที่ส่งไม่สำเร็จ:{" "}
          <span className={s.notificationFailures ? "state-bad" : "state-ok"}>{s.notificationFailures}</span>
        </p>
        <p className="muted">ข้อมูลที่ขาดหายหรือไม่ทราบสถานะไม่ได้หมายความว่าปลอดภัย</p>
      </div>
    </>
  );
}
