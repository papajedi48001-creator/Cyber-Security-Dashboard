import { can } from "@/lib/auth/authorize";
import { formatBangkok } from "@/lib/format";
import { getServices } from "@/lib/server/context";
import { requirePageSession } from "@/lib/server/session";
import { recordDuoCheckAction } from "./actions";

const STATE = {
  current: { text: "ตรวจแล้วตามรอบ", className: "state-ok" },
  overdue: { text: "เลยกำหนดตรวจ", className: "state-bad" },
  never_checked: { text: "ยังไม่เคยตรวจ", className: "state-bad" },
} as const;

export default async function DuoPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const session = await requirePageSession("evidence.read");
  const { error, notice } = await searchParams;
  const status = await getServices().duo.getStatus(session.user);
  const state = STATE[status.state as keyof typeof STATE];

  return (
    <>
      <h1>Duo (ตรวจด้วยมือ)</h1>
      <p className="card state-warn" role="note">
        Portal ยังไม่เชื่อมต่อ Duo Admin API ข้อมูลในหน้านี้มาจากการที่เจ้าหน้าที่เข้าไปตรวจใน Duo Admin Panel เอง ไม่ใช่การเฝ้าระวังแบบ real-time
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="state-ok" role="status">{notice}</p>}
      <div className="card">
        <strong>สถานะ: </strong>
        <span className={state.className}>{state.text}</span>
        {status.last ? (
          <div>
            ตรวจล่าสุดโดย <strong>{status.last.checkedByName}</strong> เมื่อ {formatBangkok(status.last.checkedAt)} · ครั้งถัดไปภายใน{" "}
            {formatBangkok(status.nextDueAt)}
          </div>
        ) : (
          <div className="muted">ยังไม่มีบันทึกการตรวจ</div>
        )}
      </div>

      <div className="card table-wrap">
        <h2>ประวัติการตรวจ</h2>
        <table>
          <thead>
            <tr><th>ตรวจเมื่อ</th><th>ผู้ตรวจ</th><th>ถูกปฏิเสธ</th><th>Fraud report</th><th>ผู้ใช้ bypass</th><th>บันทึก</th></tr>
          </thead>
          <tbody>
            {status.history.map((c) => (
              <tr key={c.id}>
                <td>{formatBangkok(c.checkedAt)}</td>
                <td>{c.checkedByName}</td>
                <td>{c.deniedAuthentications}</td>
                <td className={c.fraudReports ? "state-bad" : undefined}>{c.fraudReports}</td>
                <td className={c.bypassUsers ? "state-warn" : undefined}>{c.bypassUsers}</td>
                <td>{c.note ?? ""}</td>
              </tr>
            ))}
            {status.history.length === 0 && <tr><td colSpan={6} className="muted">ยังไม่มีบันทึก</td></tr>}
          </tbody>
        </table>
      </div>

      {can(session.user, "incident.write") && (
        <div className="card">
          <h2>บันทึกผลการตรวจ Duo Admin Panel</h2>
          <form className="stack" action={recordDuoCheckAction}>
            <input type="hidden" name="csrf" value={session.csrfToken} />
            <label>ตรวจเมื่อ (เวลาไทย)<input type="datetime-local" name="checkedAt" required /></label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" name="authLogReviewed" /> ตรวจ Authentication Log 24 ชั่วโมงล่าสุดแล้ว
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" name="adminActionsReviewed" /> ตรวจ Administrator Actions แล้ว
            </label>
            <label>จำนวนการยืนยันตัวตนที่ถูกปฏิเสธ<input type="number" name="deniedAuthentications" min="0" required /></label>
            <label>จำนวน Fraud report<input type="number" name="fraudReports" min="0" required /></label>
            <label>จำนวนผู้ใช้สถานะ bypass<input type="number" name="bypassUsers" min="0" required /></label>
            <label>บันทึก (ห้ามใส่ข้อมูลส่วนบุคคล)<textarea name="note" maxLength={1000} /></label>
            <button type="submit">บันทึกผลการตรวจ</button>
          </form>
          <p className="muted">ถ้าพบ Fraud report หรือสิ่งผิดปกติ ให้เปิด incident ในหน้า Incident ด้วย</p>
        </div>
      )}
    </>
  );
}
