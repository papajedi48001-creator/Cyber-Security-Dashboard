import { formatBangkok } from "@/lib/format";
import { getServices } from "@/lib/server/context";
import { requirePageSession } from "@/lib/server/session";
import { ConnectorForm } from "./ConnectorForms";

const SOURCE_LABELS = {
  record: "ใช้ค่าที่บันทึกในหน้านี้",
  environment: "ใช้ค่าเริ่มต้นจากไฟล์ตั้งค่าเซิร์ฟเวอร์ (.env)",
  none: "ยังไม่ได้ตั้งค่า",
} as const;

export default async function ConnectorsPage() {
  const session = await requirePageSession("config.manage");
  const { connectors } = getServices();
  await connectors.bootstrap();
  const list = await connectors.list(session.user);

  return (
    <>
      <p className="crumb">ตั้งค่าระบบ</p>
      <h1>การเชื่อมต่อ</h1>
      <p className="muted">
        ทุก connector ใช้บัญชีสิทธิ์อ่านอย่างเดียว รหัสเก็บแบบเข้ารหัสและแก้ได้อย่างเดียว ไม่แสดงกลับ การเปลี่ยนแปลงบันทึกใน audit log โดยไม่มีค่ารหัส
      </p>
      {!connectors.encryptionReady && (
        <div className="notice warn">
          ยังไม่ได้ตั้งค่า SETTINGS_ENCRYPTION_KEY บนเซิร์ฟเวอร์ จึงยังบันทึกจากหน้านี้ไม่ได้ ระบบใช้ค่าจากไฟล์ตั้งค่าไปก่อน
        </div>
      )}
      {list.map((c) => (
        <div key={c.name} className="card" style={{ display: "grid", gap: 12 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>{c.label}</h2>
            <span className={`pill ${c.lastError ? "bad" : c.lastSuccessAt ? "ok" : "waiting"}`}>
              {c.lastError ? "เชื่อมต่อไม่สำเร็จ" : c.lastSuccessAt ? "ปกติ" : "รอข้อมูล"}
            </span>
          </div>
          <dl className="kv">
            <dt>สิทธิ์</dt>
            <dd>อ่านอย่างเดียว</dd>
            <dt>โมดูลที่ใช้</dt>
            <dd>{c.modules.join(", ") || "-"}</dd>
            <dt>รหัส</dt>
            <dd>{c.secretSet ? `ตั้งค่าแล้ว${c.secretUpdatedAt ? ` · ${formatBangkok(c.secretUpdatedAt)}` : ""}` : "ยังไม่ได้ตั้ง"}</dd>
            <dt>ที่มาของค่า</dt>
            <dd>{SOURCE_LABELS[c.source]}</dd>
            <dt>สำเร็จล่าสุด</dt>
            <dd>{formatBangkok(c.lastSuccessAt)}</dd>
            {c.lastError && (
              <>
                <dt>ข้อผิดพลาดล่าสุด</dt>
                <dd className="error">{c.lastError}</dd>
              </>
            )}
          </dl>
          <ConnectorForm
            csrf={session.csrfToken}
            name={c.name}
            targetLabel={c.targetLabel}
            usernameLabel={c.usernameLabel}
            secretLabel={c.secretLabel}
            target={c.target}
            username={c.username}
            secretSet={c.secretSet}
            disabled={!connectors.encryptionReady}
          />
        </div>
      ))}
      <p className="muted small">
        รายงาน backup จาก GDCC และรายงานจาก Replica Reporter ส่งเป็นไฟล์เข้ามาเอง ไม่ต้องใช้รหัส จึงไม่อยู่ในหน้านี้
      </p>
    </>
  );
}
