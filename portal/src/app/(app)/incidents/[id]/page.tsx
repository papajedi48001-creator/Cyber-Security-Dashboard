import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/lib/auth/authorize";
import { formatBangkok } from "@/lib/format";
import { SLA_LABELS } from "@/lib/incidents/labels";
import { slaState } from "@/lib/incidents/sla";
import { IncidentRuleError, STATUS_LABELS } from "@/lib/incidents/service";
import { getServices } from "@/lib/server/context";
import { requirePageSession } from "@/lib/server/session";
import { CATEGORY_LABELS, type Category } from "@/lib/wazuh/normalize-alert";
import { incidentAction } from "../actions";

const TIMELINE_LABELS: Record<string, string> = {
  created: "เปิด incident",
  assigned: "มอบหมาย",
  acknowledged: "รับทราบ",
  status_changed: "เปลี่ยนสถานะ",
  severity_changed: "เปลี่ยนระดับ",
  closed: "ปิด",
  closure_submitted: "ส่ง Closure Evidence",
  closure_approved: "อนุมัติการปิด",
  closure_rejected: "ส่งกลับไปตรวจสอบ",
  alerts_linked: "เชื่อม alert เพิ่ม",
};

export default async function IncidentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requirePageSession("incident.read");
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  const { incidents } = getServices();
  let detail;
  try {
    detail = await incidents.getIncidentDetail(session.user, id);
  } catch (e) {
    if (e instanceof IncidentRuleError) notFound();
    throw e;
  }
  const { incident: i, timeline, alerts, evidence } = detail;
  const assignees = await incidents.listAssignees(session.user);
  const names = new Map(assignees.map((a) => [a.id, a.displayName]));
  const name = (userId: string | null) => (userId ? (names.get(userId) ?? userId) : "ระบบ");
  const sla = SLA_LABELS[slaState(i, new Date())];
  const user = session.user;
  const writable = can(user, "incident.write");
  const isOwner = i.ownerId === user.id;
  const needsReview = i.severity === "P1" || i.severity === "P2";
  const hidden = (op: string) => (
    <>
      <input type="hidden" name="csrf" value={session.csrfToken} />
      <input type="hidden" name="id" value={i.id} />
      <input type="hidden" name="op" value={op} />
    </>
  );

  return (
    <>
      <p>
        <Link href="/incidents">← รายการ incident</Link>
      </p>
      <h1>
        {i.number} <span className={`badge ${i.severity}`}>{i.severity}</span>
      </h1>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="card">
        <h2>{i.title}</h2>
        <table>
          <tbody>
            <tr><th>สถานะ</th><td>{STATUS_LABELS[i.status]}</td></tr>
            <tr><th>ผู้รับผิดชอบ</th><td>{i.ownerId ? name(i.ownerId) : "ยังไม่มอบหมาย"}</td></tr>
            <tr><th>หมวด / แหล่ง</th><td>{i.category ? (CATEGORY_LABELS[i.category as Category] ?? i.category) : "-"} / {i.sourceName ?? "-"}</td></tr>
            <tr><th>ตรวจพบ</th><td>{formatBangkok(i.detectedAt)}</td></tr>
            <tr><th>กำหนดรับทราบ</th><td className={sla.className}>{formatBangkok(i.acknowledgeDue)} ({sla.text})</td></tr>
            <tr><th>รับทราบเมื่อ</th><td>{formatBangkok(i.acknowledgedAt)}</td></tr>
            <tr><th>ควบคุมได้เมื่อ</th><td>{formatBangkok(i.mitigatedAt)}</td></tr>
            {i.cause && <tr><th>สาเหตุ</th><td>{i.cause}</td></tr>}
            {i.remediation && <tr><th>การแก้ไข</th><td>{i.remediation}</td></tr>}
            {i.closedAt && <tr><th>ปิดโดย</th><td>{name(i.closedById)} เมื่อ {formatBangkok(i.closedAt)}</td></tr>}
          </tbody>
        </table>
      </div>

      {writable && i.status !== "CLOSED" && (
        <div className="card">
          <h2>ดำเนินการ</h2>
          <div style={{ display: "grid", gap: 16 }}>
            {i.status !== "PENDING_REVIEW" && (
              <form action={incidentAction} style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
                {hidden("assign")}
                <label>
                  มอบหมายให้
                  <select name="ownerId" defaultValue={i.ownerId ?? user.id}>
                    {assignees.map((a) => (
                      <option key={a.id} value={a.id}>{a.displayName}</option>
                    ))}
                  </select>
                </label>
                <button type="submit">มอบหมาย</button>
              </form>
            )}
            {i.status === "ASSIGNED" && isOwner && (
              <form action={incidentAction}>
                {hidden("acknowledge")}
                <button type="submit">รับทราบ</button>
              </form>
            )}
            {i.status === "ACKNOWLEDGED" && (
              <form action={incidentAction}>
                {hidden("transition")}
                <input type="hidden" name="to" value="INVESTIGATING" />
                <button type="submit">เริ่มตรวจสอบ</button>
              </form>
            )}
            {i.status === "INVESTIGATING" && (
              <form action={incidentAction}>
                {hidden("transition")}
                <input type="hidden" name="to" value="MITIGATED" />
                <button type="submit">ควบคุมได้แล้ว</button>
              </form>
            )}
            {i.status === "MITIGATED" && (
              <form action={incidentAction}>
                {hidden("transition")}
                <input type="hidden" name="to" value="INVESTIGATING" />
                <button className="secondary" type="submit">กลับไปตรวจสอบ</button>
              </form>
            )}
            {i.status === "MITIGATED" && !needsReview && (
              <form className="stack" action={incidentAction}>
                {hidden("close")}
                <label>สาเหตุ<textarea name="cause" required /></label>
                <label>การแก้ไข<textarea name="remediation" required /></label>
                <button type="submit">ปิด incident</button>
              </form>
            )}
            {i.status === "MITIGATED" && needsReview && (
              <form className="stack" action={incidentAction}>
                {hidden("submit")}
                <p className="muted">P1/P2 ต้องให้ผู้อื่นที่ไม่ใช่ผู้รับผิดชอบตรวจหลักฐานก่อนปิด</p>
                <label>สาเหตุ<textarea name="cause" required /></label>
                <label>การแก้ไข<textarea name="remediation" required /></label>
                <label>สรุปหลักฐาน<textarea name="summary" required /></label>
                <label>อ้างอิงหลักฐาน (ชื่อไฟล์/ที่เก็บ)<input name="reference" required maxLength={500} /></label>
                <button type="submit">ส่งให้ตรวจ</button>
              </form>
            )}
            {i.status !== "PENDING_REVIEW" && (
              <form className="stack" action={incidentAction}>
                {hidden("severity")}
                <label>
                  เปลี่ยนระดับ
                  <select name="severity" defaultValue={i.severity}>
                    <option>P1</option><option>P2</option><option>P3</option><option>P4</option>
                  </select>
                </label>
                <label>เหตุผล<input name="reason" required maxLength={500} /></label>
                <button className="secondary" type="submit">เปลี่ยนระดับ</button>
              </form>
            )}
          </div>
        </div>
      )}

      {i.status === "PENDING_REVIEW" && evidence && (
        <div className="card">
          <h2>Closure Evidence</h2>
          <p>{evidence.summary}</p>
          <p className="muted">
            อ้างอิง: {evidence.reference} — ส่งโดย {name(evidence.submittedById)} เมื่อ {formatBangkok(evidence.submittedAt)}
          </p>
          {can(user, "incident.review") && user.id !== evidence.submittedById && !isOwner ? (
            <form className="stack" action={incidentAction}>
              {hidden("review")}
              <label>บันทึกการตรวจ (จำเป็นเมื่อส่งกลับ)<textarea name="note" /></label>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="submit" name="decision" value="approve">อนุมัติปิด</button>
                <button className="secondary" type="submit" name="decision" value="reject">ส่งกลับ</button>
              </div>
            </form>
          ) : (
            <p className="muted">รอผู้ตรวจที่ไม่ใช่ผู้รับผิดชอบหรือผู้ส่งหลักฐาน</p>
          )}
        </div>
      )}

      <div className="card table-wrap">
        <h2>Alert ที่เกี่ยวข้อง</h2>
        <table>
          <thead>
            <tr><th>ตรวจพบ</th><th>รายละเอียด</th><th>แหล่ง</th><th>ตรวจใน Wazuh</th></tr>
          </thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.wazuhAlertId}>
                <td>{formatBangkok(a.detectedAt)}</td>
                <td>{a.description} (rule {a.ruleId}, level {a.ruleLevel})</td>
                <td>{a.sourceName}</td>
                <td><a href={a.investigationUrl} target="_blank" rel="noreferrer">เปิด</a></td>
              </tr>
            ))}
            {alerts.length === 0 && (
              <tr><td colSpan={4} className="muted">ไม่มี alert เชื่อมอยู่</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card table-wrap">
        <h2>Timeline</h2>
        <table>
          <thead>
            <tr><th>เวลา</th><th>ผู้ดำเนินการ</th><th>รายการ</th><th>บันทึก</th></tr>
          </thead>
          <tbody>
            {timeline.map((t) => (
              <tr key={t.id}>
                <td>{formatBangkok(t.at)}</td>
                <td>{name(t.actorId)}</td>
                <td>{TIMELINE_LABELS[t.type] ?? t.type}</td>
                <td>{t.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
