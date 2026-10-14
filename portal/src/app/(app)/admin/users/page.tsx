import { ROLE_LABELS } from "@/lib/auth/authorize";
import { getServices } from "@/lib/server/context";
import { requirePageSession } from "@/lib/server/session";
import { setActiveAction, unlinkProviderIdAction } from "./actions";
import { CreateUserForm, LinkProviderIdForm, ResetMfaForm } from "./UserForms";

export default async function UsersPage() {
  const session = await requirePageSession("user.manage");
  const users = await getServices().auth.listUsers(session.user);
  return (
    <>
      <h1>ผู้ใช้งาน</h1>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>ชื่อผู้ใช้</th>
              <th>ชื่อ</th>
              <th>บทบาท</th>
              <th>สถานะ</th>
              <th>Provider ID</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.displayName}</td>
                <td>{ROLE_LABELS[u.role]}</td>
                <td>{!u.active ? "ปิดใช้งาน" : u.locked ? "ถูกล็อกชั่วคราว" : "ใช้งาน"}</td>
                <td>
                  {u.providerId ? (
                    <form action={unlinkProviderIdAction} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <code>{u.providerId}</code>
                      <input type="hidden" name="csrf" value={session.csrfToken} />
                      <input type="hidden" name="userId" value={u.id} />
                      <button className="secondary" type="submit">
                        ยกเลิกการผูก
                      </button>
                    </form>
                  ) : (
                    <LinkProviderIdForm csrf={session.csrfToken} userId={u.id} />
                  )}
                </td>
                <td>
                  {u.id !== session.user.id && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <ResetMfaForm csrf={session.csrfToken} userId={u.id} />
                      <form action={setActiveAction}>
                        <input type="hidden" name="csrf" value={session.csrfToken} />
                        <input type="hidden" name="userId" value={u.id} />
                        <input type="hidden" name="active" value={String(!u.active)} />
                        <button className="secondary" type="submit">
                          {u.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                        </button>
                      </form>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2>เพิ่มผู้ใช้</h2>
        <CreateUserForm csrf={session.csrfToken} />
      </div>
    </>
  );
}
