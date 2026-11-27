import Link from "next/link";
import { formatBangkok } from "@/lib/format";
import { getServices } from "@/lib/server/context";
import { requirePageSession } from "@/lib/server/session";

const PAGE_SIZE = 50;

/** Action groups for the filter; the prefix is the part before the first dot. */
const GROUPS: { prefix: string; label: string }[] = [
  { prefix: "", label: "ทั้งหมด" },
  { prefix: "auth.", label: "การเข้าสู่ระบบ" },
  { prefix: "user.", label: "บัญชีผู้ใช้" },
  { prefix: "module.", label: "การเปิด/ปิดโมดูล" },
  { prefix: "connector.", label: "การเชื่อมต่อ" },
  { prefix: "notification.", label: "การแจ้งเตือน" },
  { prefix: "incident.", label: "Incident" },
  { prefix: "asset.", label: "Asset" },
  { prefix: "backup.", label: "Backup" },
  { prefix: "port.", label: "พอร์ต" },
  { prefix: "duo.", label: "Duo" },
];

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ group?: string; before?: string }> }) {
  const session = await requirePageSession("audit.read");
  const params = await searchParams;
  const group = GROUPS.find((g) => g.prefix === params.group) ?? GROUPS[0]!;
  const page = await getServices().auditReader.list(session.user, {
    limit: PAGE_SIZE,
    before: params.before,
    actionPrefix: group.prefix,
  });
  const next = page.nextBefore ? `?${new URLSearchParams({ group: group.prefix, before: page.nextBefore })}` : null;

  return (
    <>
      <p className="crumb">ตั้งค่าระบบ</p>
      <h1>บันทึกการใช้งาน</h1>
      <p className="muted">
        บันทึกแบบเพิ่มได้อย่างเดียว ไม่มีใครแก้หรือลบได้ รวมการเข้าสู่ระบบ การเข้าสู่ระบบที่ถูกปฏิเสธ การเปลี่ยนการตั้งค่า และการดำเนินการในโมดูล
        เวลาแสดงเป็นเวลาไทย
      </p>
      <form className="row" method="get">
        <label className="row">
          ประเภท
          <select name="group" defaultValue={group.prefix}>
            {GROUPS.map((g) => (
              <option key={g.prefix} value={g.prefix}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary sm" type="submit">
          กรอง
        </button>
      </form>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>เวลา</th>
              <th>ผู้ทำ</th>
              <th>การกระทำ</th>
              <th>เป้าหมาย</th>
              <th>รายละเอียด</th>
            </tr>
          </thead>
          <tbody>
            {page.records.map((r) => (
              <tr key={r.id}>
                <td className="small" style={{ whiteSpace: "nowrap" }}>{formatBangkok(r.at)}</td>
                <td>{r.actorLabel}</td>
                <td><code>{r.action}</code></td>
                <td className="small">
                  {r.targetType}
                  {r.targetId ? ` · ${r.targetId}` : ""}
                </td>
                <td className="small muted"><code>{r.metadata ? JSON.stringify(r.metadata) : ""}</code></td>
              </tr>
            ))}
            {page.records.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">ไม่มีบันทึกในประเภทนี้</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="row">
        {params.before && <Link href={`?${new URLSearchParams({ group: group.prefix })}`}>กลับไปหน้าล่าสุด</Link>}
        {next && <Link href={next}>หน้าถัดไป (เก่ากว่า)</Link>}
      </p>
    </>
  );
}
