import { can } from "@/lib/auth/authorize";
import { BACKUP_FEATURES } from "@/lib/backups/service";
import type { BackupHealth } from "@/lib/backups/status";
import { formatBangkok } from "@/lib/format";
import { getServices } from "@/lib/server/context";
import { requirePageSession } from "@/lib/server/session";
import { createJobAction, importReportAction, recordEvidenceAction, recordVerificationAction } from "./actions";

const HEALTH: Record<BackupHealth, { text: string; className: string }> = {
  ok: { text: "สำรองตามรอบ", className: "state-ok" },
  failing: { text: "ล้มเหลว", className: "state-bad" },
  stale: { text: "ขาดรอบ", className: "state-bad" },
  unencrypted: { text: "ไม่ได้เข้ารหัส", className: "state-bad" },
  unknown: { text: "ไม่มีข้อมูล", className: "state-warn" },
};

const gb = (bytes: number | null) => (bytes === null ? "-" : `${(bytes / 1024 ** 3).toFixed(1)} GB`);

export default async function BackupsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const session = await requirePageSession("evidence.read");
  const { error, notice } = await searchParams;
  const statuses = await getServices().backups.listBackupStatus(session.user);
  const canRecord = can(session.user, "backup.record");
  const csrf = <input type="hidden" name="csrf" value={session.csrfToken} />;
  const jobOptions = statuses.map((s) => <option key={s.job.id}>{s.job.name}</option>);

  return (
    <>
      <h1>Backup Evidence</h1>
      <p className="muted">
        แสดงผลตามที่ระบบ backup รายงาน การ backup สำเร็จไม่ได้แปลว่ากู้คืนได้ ต้องมีผลทดสอบกู้คืนแยกต่างหาก Portal ไม่มีปุ่มสั่ง backup, กู้คืน หรือลบไฟล์
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="state-ok" role="status">{notice}</p>}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>งาน</th><th>สถานะ</th><th>สำเร็จล่าสุด</th><th>อายุข้อมูล</th><th>ล้มเหลวติดกัน</th>
              <th>ขนาด</th><th>เข้ารหัส</th><th>ปลายทาง</th><th>เก็บถึง</th><th>การกู้คืน</th>
            </tr>
          </thead>
          <tbody>
            {statuses.map((s) => (
              <tr key={s.job.id}>
                <td>{s.job.name}{s.job.assetName && <div className="muted">{s.job.assetName}</div>}</td>
                <td className={HEALTH[s.health].className}>{HEALTH[s.health].text}</td>
                <td>{formatBangkok(s.lastSuccessAt)}</td>
                <td>{s.dataAgeHours === null ? "-" : `${s.dataAgeHours} ชม. (รอบ ${s.job.expectedIntervalHours} ชม.)`}</td>
                <td className={s.consecutiveFailures ? "state-bad" : undefined}>{s.consecutiveFailures}</td>
                <td>{gb(s.sizeBytes)}</td>
                <td>{s.encrypted === null ? "-" : s.encrypted ? "ใช่" : "ไม่"}</td>
                <td>{s.job.destination}</td>
                <td>{formatBangkok(s.retentionUntil)}</td>
                <td className={s.recovery === "verified" ? "state-ok" : "state-warn"}>
                  {s.recovery === "verified" ? "ทดสอบกู้คืนผ่าน" : "ยังไม่ยืนยันการกู้คืน"}
                  {s.lastVerification && (
                    <div className="muted">
                      ทดสอบล่าสุด {formatBangkok(s.lastVerification.testedAt)} ({s.lastVerification.result === "PASSED" ? "ผ่าน" : "ไม่ผ่าน"})
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {statuses.length === 0 && (
              <tr><td colSpan={10} className="muted">ยังไม่มีงาน backup ที่ติดตาม</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {canRecord && statuses.length > 0 && (
        <>
          <div className="card">
            <h2>บันทึกผล backup</h2>
            <form className="stack" action={recordEvidenceAction}>
              {csrf}
              <label>งาน<select name="jobName">{jobOptions}</select></label>
              <label>ผล<select name="result"><option value="SUCCESS">สำเร็จ</option><option value="FAILED">ล้มเหลว</option></select></label>
              <label>เสร็จเมื่อ (เวลาไทย)<input type="datetime-local" name="completedAt" required /></label>
              <label>ขนาด (GB)<input type="number" name="sizeGb" min="0" step="0.1" /></label>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="encrypted" defaultChecked /> เข้ารหัสก่อนส่ง GDCC</label>
              <label>เก็บถึงวันที่<input type="date" name="retentionUntil" /></label>
              <button type="submit">บันทึกผล backup</button>
            </form>
          </div>
          <div className="card">
            <h2>นำเข้ารายงานจากระบบ backup (CSV)</h2>
            <form className="stack" action={importReportAction}>
              {csrf}
              <label>
                job,result,completed_at,size_bytes,encrypted,retention_until
                <textarea name="csv" rows={6} required placeholder="hosxp-db-nightly,SUCCESS,2026-10-14T01:00:00+07:00,5368709120,yes,2027-10-14" />
              </label>
              <button type="submit">นำเข้า</button>
            </form>
          </div>
          <div className="card">
            <h2>บันทึกผลทดสอบกู้คืน</h2>
            <form className="stack" action={recordVerificationAction}>
              {csrf}
              <label>งาน<select name="jobName">{jobOptions}</select></label>
              <label>ทดสอบเมื่อ (เวลาไทย)<input type="datetime-local" name="testedAt" required /></label>
              <label>ผล<select name="result"><option value="PASSED">กู้คืนได้</option><option value="FAILED">กู้คืนไม่ได้</option></select></label>
              <label>อ้างอิงหลักฐาน (ชื่อไฟล์/ที่เก็บ)<input name="reference" required maxLength={500} /></label>
              <button type="submit">บันทึกผลทดสอบกู้คืน</button>
            </form>
          </div>
        </>
      )}

      {can(session.user, "config.manage") && (
        <div className="card">
          <h2>เพิ่มงาน backup ที่ติดตาม</h2>
          <form className="stack" action={createJobAction}>
            {csrf}
            <label>ชื่องาน (A-Z a-z 0-9 . _ -)<input name="name" required /></label>
            <label>Asset (ถ้ามี)<input name="assetName" /></label>
            <label>รอบที่คาดไว้ (ชั่วโมง)<input type="number" name="expectedIntervalHours" min="1" max="744" defaultValue={24} required /></label>
            <label>ปลายทาง<input name="destination" defaultValue="GDCC" required /></label>
            <button type="submit">เพิ่มงาน</button>
          </form>
        </div>
      )}

      <div className="card muted">
        การจัดการไฟล์ backup (ค้นหา, เก็บถาวร, ทำลาย) {BACKUP_FEATURES.lifecycleRequests ? "เปิดใช้" : "ยังไม่เปิดใช้ในระยะนี้"} ต้องผ่านคำขอ, การอนุมัติ และ Backup Deletion Hold
      </div>
    </>
  );
}
