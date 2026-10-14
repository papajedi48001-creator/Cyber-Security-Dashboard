import { can } from "@/lib/auth/authorize";
import { getServices } from "@/lib/server/context";
import { requirePageSession } from "@/lib/server/session";
import { AssetForm } from "./AssetForm";

export default async function AssetsPage() {
  const session = await requirePageSession("asset.read");
  const assets = await getServices().assets.listAssets(session.user);
  return (
    <>
      <h1>Asset Register</h1>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>ชื่อ</th>
              <th>หน้าที่</th>
              <th>ผู้รับผิดชอบ</th>
              <th>Critical</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>{a.role}</td>
                <td>{a.owner}</td>
                <td>{a.critical ? `ใช่ — ${a.criticalReason}` : "-"}</td>
              </tr>
            ))}
            {assets.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  ยังไม่มี asset
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {can(session.user, "asset.write") && (
        <div className="card">
          <h2>เพิ่ม asset</h2>
          <AssetForm csrf={session.csrfToken} />
        </div>
      )}
    </>
  );
}
