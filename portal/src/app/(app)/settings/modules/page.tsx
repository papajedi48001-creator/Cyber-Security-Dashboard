import { ROLE_LABELS, type Role } from "@/lib/auth/authorize";
import { isModuleEnabled, MODULES, type ModuleAccess } from "@/lib/modules/registry";
import { getServices } from "@/lib/server/context";
import { requirePageSession } from "@/lib/server/session";
import { setModuleEnabledAction } from "./actions";

const ROLES: Role[] = ["SECURITY_ADMINISTRATOR", "SECURITY_OPERATOR", "EXECUTIVE_VIEWER"];
const ACCESS_LABELS: Record<ModuleAccess, string> = { none: "-", view: "ดู", act: "ดำเนินการ", manage: "จัดการ" };

export default async function ModulesSettingsPage() {
  const session = await requirePageSession("config.manage");
  const settings = await getServices().modules.settings();
  return (
    <>
      <p className="crumb">ตั้งค่าระบบ</p>
      <h1>โมดูล</h1>
      <p className="muted">
        โมดูลหลักปิดไม่ได้ การปิดโมดูลจะซ่อนเมนู หยุดดึงข้อมูลและแจ้งเตือนของโมดูลนั้น แต่เก็บข้อมูลเดิมไว้ ทุกการเปลี่ยนแปลงถูกบันทึกใน audit log
      </p>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>โมดูล</th>
              <th>Connector</th>
              {ROLES.map((r) => (
                <th key={r}>{ROLE_LABELS[r]}</th>
              ))}
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {MODULES.map((m) => {
              const enabled = isModuleEnabled(m.id, settings);
              return (
                <tr key={m.id}>
                  <td>
                    <b>{m.name}</b>
                    {m.core && <span className="tag"> โมดูลหลัก</span>}
                  </td>
                  <td className="muted small">{m.connectors.join(", ") || "-"}</td>
                  {ROLES.map((r) => (
                    <td key={r} className="small">
                      {ACCESS_LABELS[m.permissions[r]]}
                    </td>
                  ))}
                  <td>
                    {m.core ? (
                      <span className="pill ok">เปิดเสมอ</span>
                    ) : (
                      <form action={setModuleEnabledAction} className="row">
                        <input type="hidden" name="csrf" value={session.csrfToken} />
                        <input type="hidden" name="moduleId" value={m.id} />
                        <input type="hidden" name="enabled" value={String(!enabled)} />
                        <span className={`pill ${enabled ? "ok" : "off"}`}>{enabled ? "เปิด" : "ปิด"}</span>
                        <button className="secondary sm" type="submit">
                          {enabled ? "ปิดโมดูล" : "เปิดโมดูล"}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">สิทธิ์ต่อบทบาทกำหนดตายตัวในระบบ และให้โรงพยาบาลยืนยันตอน UAT</p>
    </>
  );
}
