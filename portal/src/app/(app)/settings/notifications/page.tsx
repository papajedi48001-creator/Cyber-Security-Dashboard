import { formatBangkok } from "@/lib/format";
import { TEST_MESSAGE } from "@/lib/notifications/delivery";
import { buildNotificationSummary, renderNotificationText } from "@/lib/notifications/payload";
import { getServices } from "@/lib/server/context";
import { requirePageSession } from "@/lib/server/session";
import { TestSendButton } from "./TestSendButton";

export default async function NotificationSettingsPage() {
  const session = await requirePageSession("config.manage");
  const { config, notifier } = getServices();
  const failures = await notifier.openFailures();
  const email = config.notifications.email;
  const line = config.notifications.line;
  // Synthetic example only: shows the Notification Summary fields, never real data.
  const sample = renderNotificationText(
    buildNotificationSummary(
      { id: "example", number: "INC-2026-0001", severity: "P2", detectedAt: new Date(), sourceName: "example-firewall" },
      config.portalBaseUrl,
    ),
  );
  const channels = [
    {
      name: "EMAIL" as const,
      label: "อีเมล",
      configured: Boolean(email),
      detail: email ? `ผู้รับ ${email.to.length} คน` : "ยังไม่ได้ตั้งค่า SMTP และผู้รับ",
    },
    {
      name: "LINE" as const,
      label: "LINE OA",
      configured: Boolean(line),
      detail: line ? "ตั้งค่า token และปลายทางแล้ว" : "ยังไม่ได้ตั้งค่า token และปลายทาง",
    },
  ];

  return (
    <>
      <p className="crumb">ตั้งค่าระบบ</p>
      <h1>การแจ้งเตือน</h1>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>ช่องทาง</th>
              <th>สถานะ</th>
              <th>รายละเอียด</th>
              <th>ระดับที่ส่ง</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {channels.map((c) => (
              <tr key={c.name}>
                <td><b>{c.label}</b></td>
                <td>
                  <span className={`pill ${c.configured ? "ok" : "off"}`}>{c.configured ? "เปิด" : "ยังไม่ตั้งค่า"}</span>
                </td>
                <td className="small">{c.detail}</td>
                <td className="small">P1, P2 ส่งทันที · P3, P4 ส่งในเวลาทำการถัดไป</td>
                <td>{c.configured && <TestSendButton csrf={session.csrfToken} channel={c.name} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2>ตัวอย่างข้อความ</h2>
        <p className="muted small">ข้อความแจ้งเตือนมีเฉพาะฟิลด์ของ Notification Summary ไม่มีชื่อผู้ใช้ IP หรือข้อมูลผู้ป่วย (ตัวอย่างสมมติ)</p>
        <pre className="card small" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{sample}</pre>
        <p className="muted small">ข้อความทดสอบ: {TEST_MESSAGE}</p>
      </div>
      <div className="card table-wrap">
        <h2>ส่งไม่สำเร็จที่ยังเปิดอยู่</h2>
        <table>
          <tbody>
            {failures.map((f) => (
              <tr key={f.id}>
                <td>{f.incidentNumber}</td>
                <td>{f.channel}</td>
                <td>{f.status === "ESCALATED" ? "เลิกลองแล้ว" : `ลองแล้ว ${f.attempts} ครั้ง`}</td>
                <td className="small muted">{f.lastError}</td>
                <td className="small">{formatBangkok(f.nextAttemptAt)}</td>
              </tr>
            ))}
            {failures.length === 0 && (
              <tr>
                <td className="muted">ไม่มี</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        ตอนนี้ค่าช่องทางยังอ่านจากไฟล์ตั้งค่าของเซิร์ฟเวอร์ (.env) การแก้ไขผู้รับ token และการเปิด/ปิดจากหน้านี้จะมากับหน้าการเชื่อมต่อ ซึ่งเก็บรหัสแบบเข้ารหัส
      </p>
    </>
  );
}
