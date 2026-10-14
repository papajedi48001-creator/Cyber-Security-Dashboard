import { formatBangkok } from "@/lib/format";
import { prisma } from "@/lib/db/client";
import { getServices } from "@/lib/server/context";
import { requirePageSession } from "@/lib/server/session";
import { getSourceOverview } from "@/lib/sources";

const STATUS_LABEL = { healthy: "ปกติ", stale: "ขาดหาย", unknown: "ไม่ทราบสถานะ" } as const;
const STATUS_CLASS = { healthy: "state-ok", stale: "state-bad", unknown: "state-warn" } as const;

export default async function SourcesPage() {
  const session = await requirePageSession("source.read");
  const { config } = getServices();
  const overview = await getSourceOverview(prisma, session.user, config.wazuh.pollIntervalSeconds);
  return (
    <>
      <h1>สุขภาพแหล่ง Log</h1>
      <div className="card">
        <strong>การดึงข้อมูลจาก Wazuh: </strong>
        <span className={overview.connector.status === "fresh" ? "state-ok" : "state-bad"}>{overview.connector.reason}</span>
        <div className="muted">สำเร็จล่าสุด {formatBangkok(overview.connector.lastSuccessAt)}</div>
        {overview.connector.lastError && <div className="error">ข้อผิดพลาดล่าสุด: {overview.connector.lastError}</div>}
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>แหล่ง</th>
              <th>ประเภท</th>
              <th>Asset</th>
              <th>สถานะ</th>
              <th>ข้อมูลล่าสุด</th>
              <th>รายละเอียด</th>
            </tr>
          </thead>
          <tbody>
            {overview.sources.map((s) => (
              <tr key={s.name}>
                <td>{s.name}</td>
                <td>{s.type}</td>
                <td>{s.assetName ?? "-"}</td>
                <td className={STATUS_CLASS[s.status]}>{STATUS_LABEL[s.status]}</td>
                <td>{formatBangkok(s.lastEventAt)}</td>
                <td>{s.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
