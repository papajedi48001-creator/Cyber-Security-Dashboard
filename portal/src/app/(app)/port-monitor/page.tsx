import { can } from "@/lib/auth/authorize";
import { formatBangkok } from "@/lib/format";
import { MAX_EXCEPTION_DAYS, type PortClassification } from "@/lib/port-monitor/policy";
import { getServices } from "@/lib/server/context";
import { requirePageSession } from "@/lib/server/session";
import { addExceptionAction, importFirewallAction, importScanAction, revokeExceptionAction } from "./actions";

const CLASSIFICATION: Record<PortClassification, { text: string; className: string }> = {
  APPROVED: { text: "อนุมัติแล้ว", className: "state-ok" },
  UNAPPROVED: { text: "ไม่ได้รับอนุมัติ", className: "state-bad" },
  EXCEPTION_EXPIRED: { text: "ข้อยกเว้นหมดอายุ", className: "state-bad" },
  CONFIGURED_NOT_REACHABLE: { text: "มี rule แต่สแกนไม่พบ ควรทบทวน", className: "state-warn" },
};

export default async function PortMonitorPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const session = await requirePageSession("evidence.read");
  const { error, notice } = await searchParams;
  const snap = await getServices().ports.getSnapshot(session.user);
  const canImport = can(session.user, "backup.record");
  const canApprove = can(session.user, "config.manage");
  const csrf = <input type="hidden" name="csrf" value={session.csrfToken} />;

  return (
    <>
      <h1>พอร์ตเปิดสู่ภายนอกและการเชื่อมต่อออกที่ห้าม</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="state-ok" role="status">{notice}</p>}
      <div className="card">
        <strong>ผลสแกนจากภายนอก: </strong>
        <span className={snap.scan.status === "fresh" ? "state-ok" : "state-bad"}>{snap.scan.reason}</span>
        <div className="muted">
          สแกนล่าสุด {formatBangkok(snap.scan.at)} {snap.scan.scanner && `(${snap.scan.scanner})`} · rule จาก Sophos ล่าสุด{" "}
          {formatBangkok(snap.firewallRulesAt)}
        </div>
      </div>

      <div className="card table-wrap">
        <h2>External Port Exposure</h2>
        <table>
          <thead>
            <tr><th>Address</th><th>Port</th><th>บริการ</th><th>พบจาก</th><th>สถานะ</th><th>ระดับ</th><th>ข้อยกเว้น</th></tr>
          </thead>
          <tbody>
            {snap.exposures.map((f) => (
              <tr key={`${f.address}-${f.port}-${f.protocol}`}>
                <td>{f.address}</td>
                <td>{f.port}/{f.protocol}</td>
                <td>{f.service ?? "-"}</td>
                <td>{[f.seenInScan && "สแกน", f.inFirewallRules && "Sophos rule"].filter(Boolean).join(", ")}</td>
                <td className={CLASSIFICATION[f.classification].className}>{CLASSIFICATION[f.classification].text}</td>
                <td>{f.severity ? <span className={`badge ${f.severity}`}>{f.severity}</span> : "-"}</td>
                <td>{f.exception ? `${f.exception.reason} (ถึง ${formatBangkok(f.exception.expiresAt)})` : "-"}</td>
              </tr>
            ))}
            {snap.exposures.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {snap.scan.status === "fresh" ? "ผลสแกนล่าสุดไม่พบพอร์ตเปิด" : "ยังไม่ทราบ: ไม่มีผลสแกนที่เป็นปัจจุบัน"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card table-wrap">
        <h2>Restricted Egress (7 วันล่าสุด)</h2>
        <table>
          <thead>
            <tr><th>Port</th><th>จำนวนครั้ง</th><th>ล่าสุด</th><th>สถานะ</th><th>ตรวจใน Wazuh</th></tr>
          </thead>
          <tbody>
            {snap.egress.map((e) => (
              <tr key={`${e.port}-${e.protocol}`}>
                <td>{e.port}/{e.protocol}</td>
                <td>{e.events}</td>
                <td>{formatBangkok(e.lastSeen)}</td>
                <td className={CLASSIFICATION[e.classification].className}>{CLASSIFICATION[e.classification].text}</td>
                <td><a href={e.investigationUrl} target="_blank" rel="noreferrer">เปิด</a></td>
              </tr>
            ))}
            {snap.egress.length === 0 && (
              <tr><td colSpan={5} className="muted">ไม่พบการเชื่อมต่อออกไปยังพอร์ตที่ห้ามจาก Wazuh</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card table-wrap">
        <h2>ข้อยกเว้น</h2>
        <table>
          <thead>
            <tr><th>ประเภท</th><th>Address</th><th>Port</th><th>เหตุผล</th><th>ผู้รับผิดชอบ</th><th>หมดอายุ</th><th>สถานะ</th>{canApprove && <th></th>}</tr>
          </thead>
          <tbody>
            {snap.exceptions.map((e) => (
              <tr key={e.id}>
                <td>{e.family === "EXTERNAL_EXPOSURE" ? "เปิดสู่ภายนอก" : "เชื่อมต่อออก"}</td>
                <td>{e.address ?? "ทุกปลายทาง"}</td>
                <td>{e.port}/{e.protocol}</td>
                <td>{e.reason}</td>
                <td>{e.owner}</td>
                <td>{formatBangkok(e.expiresAt)}</td>
                <td className={e.state === "active" ? "state-ok" : "state-warn"}>
                  {e.state === "active" ? "ใช้งาน" : e.state === "expired" ? "หมดอายุ" : "ยกเลิกแล้ว"}
                </td>
                {canApprove && (
                  <td>
                    {e.state === "active" && (
                      <form action={revokeExceptionAction}>
                        {csrf}
                        <input type="hidden" name="id" value={e.id} />
                        <button className="secondary" type="submit">ยกเลิก</button>
                      </form>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {snap.exceptions.length === 0 && (
              <tr><td colSpan={canApprove ? 8 : 7} className="muted">ยังไม่มีข้อยกเว้น</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {canImport && (
        <>
          <div className="card">
            <h2>นำเข้าผลสแกนจากภายนอก</h2>
            <p className="muted">ไฟล์ JSON format external-exposure-scan/v1 จากเครื่องสแกนนอกโรงพยาบาล (ดู infrastructure/external-scan)</p>
            <form className="stack" action={importScanAction}>
              {csrf}
              <label>ไฟล์ผลสแกน<input type="file" name="file" accept="application/json,.json" /></label>
              <label>หรือวาง JSON<textarea name="json" rows={4} /></label>
              <button type="submit">นำเข้าผลสแกน</button>
            </form>
          </div>
          <div className="card">
            <h2>นำเข้า rule ที่เปิดบริการจาก Sophos</h2>
            <form className="stack" action={importFirewallAction}>
              {csrf}
              <label>
                rule_name,public_address,port,protocol
                <textarea name="csv" rows={4} placeholder="Web server NAT,203.0.113.10,443,TCP" />
              </label>
              <button type="submit">นำเข้า rule</button>
            </form>
          </div>
        </>
      )}

      {canApprove && (
        <div className="card">
          <h2>อนุมัติข้อยกเว้น (ไม่เกิน {MAX_EXCEPTION_DAYS} วัน)</h2>
          <form className="stack" action={addExceptionAction}>
            {csrf}
            <label>
              ประเภท
              <select name="family">
                <option value="EXTERNAL_EXPOSURE">เปิดพอร์ตสู่ภายนอก</option>
                <option value="RESTRICTED_EGRESS">เชื่อมต่อออกไปยังพอร์ตที่ห้าม</option>
              </select>
            </label>
            <label>Public address (เฉพาะการเปิดพอร์ต)<input name="address" /></label>
            <label>Port<input type="number" name="port" min="1" max="65535" required /></label>
            <label>Protocol<select name="protocol"><option>TCP</option><option>UDP</option></select></label>
            <label>เหตุผล<input name="reason" required maxLength={500} /></label>
            <label>ผู้รับผิดชอบ<input name="owner" required maxLength={128} /></label>
            <label>หมดอายุวันที่<input type="date" name="expiresAt" required /></label>
            <button type="submit">อนุมัติข้อยกเว้น</button>
          </form>
        </div>
      )}
    </>
  );
}
