import Link from "next/link";
import { can } from "@/lib/auth/authorize";
import { formatBangkok } from "@/lib/format";
import { SLA_LABELS } from "@/lib/incidents/labels";
import { slaState } from "@/lib/incidents/sla";
import { STATUS_LABELS, type IncidentFilter } from "@/lib/incidents/service";
import { getServices } from "@/lib/server/context";
import { requirePageSession } from "@/lib/server/session";
import { CATEGORY_LABELS, suggestedSeverity, type Category } from "@/lib/wazuh/normalize-alert";
import { createIncidentAction, promoteAlertAction } from "./actions";

const VIEWS: { value: NonNullable<IncidentFilter["view"]>; label: string }[] = [
  { value: "open", label: "ยังไม่ปิด" },
  { value: "closed", label: "ปิดแล้ว" },
  { value: "all", label: "ทั้งหมด" },
];

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<{ view?: string; error?: string }> }) {
  const session = await requirePageSession("incident.read");
  const params = await searchParams;
  const view = VIEWS.find((v) => v.value === params.view)?.value ?? "open";
  const { incidents } = getServices();
  const [list, events] = await Promise.all([
    incidents.listIncidents(session.user, { view }),
    incidents.listSecurityEvents(session.user, 50),
  ]);
  const now = new Date();
  const writable = can(session.user, "incident.write");
  return (
    <>
      <h1>Incident</h1>
      {params.error && <p className="error" role="alert">{params.error}</p>}
      <nav style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        {VIEWS.map((v) => (
          <Link key={v.value} href={`/incidents?view=${v.value}`} aria-current={v.value === view ? "page" : undefined}>
            {v.label}
          </Link>
        ))}
      </nav>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>เลขที่</th>
              <th>ระดับ</th>
              <th>หัวข้อ</th>
              <th>สถานะ</th>
              <th>ตรวจพบ</th>
              <th>SLA รับทราบ</th>
            </tr>
          </thead>
          <tbody>
            {list.map((i) => {
              const sla = SLA_LABELS[slaState(i, now)];
              return (
                <tr key={i.id}>
                  <td>
                    <Link href={`/incidents/${i.id}`}>{i.number}</Link>
                  </td>
                  <td>
                    <span className={`badge ${i.severity}`}>{i.severity}</span>
                  </td>
                  <td>{i.title}</td>
                  <td>{STATUS_LABELS[i.status]}</td>
                  <td>{formatBangkok(i.detectedAt)}</td>
                  <td className={sla.className}>
                    {sla.text} ({formatBangkok(i.acknowledgeDue)})
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  ไม่มี incident ในมุมมองนี้
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card table-wrap">
        <h2>Security Event รอคัดกรอง</h2>
        <p className="muted">Alert ระดับต่ำกว่า P2 จาก Wazuh ที่ยังไม่อยู่ใน incident (ล่าสุด 50 รายการ)</p>
        <table>
          <thead>
            <tr>
              <th>ตรวจพบ</th>
              <th>หมวด</th>
              <th>รายละเอียด</th>
              <th>แหล่ง</th>
              <th>ตรวจใน Wazuh</th>
              {writable && <th>ยกระดับเป็น incident</th>}
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.wazuhAlertId}>
                <td>{formatBangkok(e.detectedAt)}</td>
                <td>{CATEGORY_LABELS[e.category as Category] ?? e.category}</td>
                <td>
                  {e.description} (rule {e.ruleId}, level {e.ruleLevel})
                </td>
                <td>{e.sourceName}</td>
                <td>
                  <a href={e.investigationUrl} target="_blank" rel="noreferrer">
                    เปิด
                  </a>
                </td>
                {writable && (
                  <td>
                    <form action={promoteAlertAction} style={{ display: "flex", gap: 6 }}>
                      <input type="hidden" name="csrf" value={session.csrfToken} />
                      <input type="hidden" name="alertId" value={e.wazuhAlertId} />
                      <select name="severity" defaultValue={suggestedSeverity(e.ruleLevel)} aria-label="ระดับ">
                        {["P1", "P2", "P3", "P4"].map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                      <button type="submit">ยกระดับ</button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={writable ? 6 : 5} className="muted">
                  ไม่มี Security Event รอคัดกรอง
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {writable && (
        <div className="card">
          <h2>เปิด incident ใหม่</h2>
          <form className="stack" action={createIncidentAction}>
            <input type="hidden" name="csrf" value={session.csrfToken} />
            <label>
              หัวข้อ (ห้ามใส่ข้อมูลผู้ป่วย)
              <input name="title" required maxLength={255} />
            </label>
            <label>
              ระดับ
              <select name="severity" defaultValue="P3">
                <option>P1</option>
                <option>P2</option>
                <option>P3</option>
                <option>P4</option>
              </select>
            </label>
            <label>
              เวลาที่ตรวจพบ (เวลาไทย)
              <input type="datetime-local" name="detectedAt" required />
            </label>
            <button type="submit">เปิด incident</button>
          </form>
        </div>
      )}
    </>
  );
}
