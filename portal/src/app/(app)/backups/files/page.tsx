import Link from "next/link";
import { can } from "@/lib/auth/authorize";
import { readFilesStatus, readNasStatus } from "@/lib/backup-files/exchange";
import { evaluateNasStatus, NAS_STALE_HOURS, type NasView } from "@/lib/backup-files/nas";
import { DELETION_HOLD_HOURS, type BackupFileRequest, type RequestStatus } from "@/lib/backup-files/service";
import { EXPAND_AT_PERCENT, evaluateFilesStatus, STATUS_STALE_MINUTES, type FilesState, type VolumeLevel } from "@/lib/backup-files/status";
import { formatBangkok } from "@/lib/format";
import { getServices } from "@/lib/server/context";
import { requirePageSession } from "@/lib/server/session";
import { approveDestroyAction, cancelDestroyAction, proposeDestroyAction, rejectDestroyAction } from "./actions";

const STATE: Record<FilesState | "not_configured", { text: string; className: string }> = {
  fresh: { text: "ข้อมูลเป็นปัจจุบัน", className: "state-ok" },
  stale: { text: "ข้อมูลไม่เป็นปัจจุบัน", className: "state-bad" },
  unavailable: { text: "ไม่มีข้อมูลจาก GDCC", className: "state-bad" },
  not_configured: { text: "ยังไม่ได้ตั้งค่า", className: "state-warn" },
};

const VOLUME: Record<VolumeLevel, { text: string; className: string }> = {
  ok: { text: "พื้นที่พอ", className: "state-ok" },
  expand: { text: `เกิน ${EXPAND_AT_PERCENT}% ขอพื้นที่เพิ่มจาก GDCC ได้`, className: "state-warn" },
  pruning: { text: "เกินเกณฑ์ ระบบจะลบไฟล์เก่าสุดอัตโนมัติ", className: "state-bad" },
};

const REQUEST: Record<RequestStatus, { text: string; className: string }> = {
  PROPOSED: { text: "รออนุมัติ", className: "state-warn" },
  APPROVED: { text: "อนุมัติแล้ว อยู่ในช่วงพักรอ", className: "state-warn" },
  REJECTED: { text: "ไม่อนุมัติ", className: "muted" },
  CANCELLED: { text: "ยกเลิก", className: "muted" },
  SENT: { text: "ส่งให้ GDCC แล้ว รอผล", className: "state-warn" },
  DESTROYED: { text: "ทำลายแล้ว", className: "state-ok" },
  FAILED: { text: "GDCC ไม่ดำเนินการ", className: "state-bad" },
};

const OUTCOME: Record<string, string> = {
  protected: "เป็นไฟล์ล่าสุดที่ต้องเก็บไว้",
  size_mismatch: "ขนาดไฟล์ไม่ตรงกับที่อนุมัติ",
  not_found: "ไม่พบไฟล์บน GDCC",
  rejected: "คำขอไม่ถูกต้อง",
  file_gone: "ไฟล์ถูกลบอัตโนมัติไปก่อนเพราะพื้นที่เต็ม",
};

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
const thaiDay = (date: string) =>
  new Intl.DateTimeFormat("th-TH", { timeZone: "UTC", day: "numeric", month: "short", weekday: "short" }).format(new Date(`${date}T00:00:00Z`));

export default async function BackupFilesPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const session = await requirePageSession("evidence.read");
  const { error, notice } = await searchParams;
  const { config, backupFiles } = getServices();
  const now = new Date();
  const configured = Boolean(config.gdccFiles);
  const view = evaluateFilesStatus(config.gdccFiles ? await readFilesStatus(config.gdccFiles.statusPath) : null, now);
  const nas = evaluateNasStatus(config.gdccFiles ? await readNasStatus(config.gdccFiles.statusPath) : null, now);
  const requests = await backupFiles.list(session.user);
  const open = new Map(requests.filter((r) => ["PROPOSED", "APPROVED", "SENT"].includes(r.status)).map((r) => [r.fileName, r]));
  const state = STATE[configured ? view.state : "not_configured"];
  const canPropose = backupFiles.enabled && view.state === "fresh" && can(session.user, "backup.record");
  const isAdmin = can(session.user, "config.manage");
  const csrf = <input type="hidden" name="csrf" value={session.csrfToken} />;
  const missing = view.days.filter((d) => d.state === "missing").length;

  return (
    <>
      <p className="back"><Link href="/backups">← Backup Evidence</Link></p>
      <h1>ไฟล์ backup HOSxP</h1>
      <p className="lead">
        ไฟล์ ZIP รายวันของ HOSxP สองที่: NAS ในโรงพยาบาล (ลบไฟล์เก่าเองตามจำนวนชุดที่กำหนด) และสำเนาในดิสก์เข้ารหัสบน VM GDCC
        Portal เห็นเฉพาะชื่อไฟล์ ขนาด และผลตรวจ ไม่มีปุ่มลบทันทีหรือกู้คืน การทำลายไฟล์บน GDCC ก่อนเวลาต้องมีผู้เสนอ ผู้อนุมัติอีกคน และช่วงพักรอ {DELETION_HOLD_HOURS} ชั่วโมงที่ยกเลิกได้
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="state-ok" role="status">{notice}</p>}

      <NasSection nas={nas} />

      <h2 className="section-title">สำเนาบน GDCC</h2>
      <div className="card" aria-labelledby="volume-heading">
        <h2 id="volume-heading">สถานะที่เก็บบน GDCC</h2>
        <p>
          ข้อมูลจาก GDCC: <strong className={state.className}>{state.text}</strong>
          {view.generatedAt && <span className="muted"> · รายงานล่าสุด {formatBangkok(view.generatedAt)} (เกณฑ์ {STATUS_STALE_MINUTES} นาที)</span>}
        </p>
        {view.state === "stale" && <p className="card state-bad">ข้อมูลข้างล่างเป็นของรอบที่แล้ว อาจไม่ตรงกับไฟล์ที่มีอยู่จริง และยื่นคำขอใหม่ไม่ได้จนกว่าข้อมูลจะกลับมา</p>}
        {!configured && <p className="muted">ตั้ง GDCC_FILES_STATUS_PATH ใน .env ของ Portal และเปิด timer sync ตาม runbook</p>}
        {view.volume && (
          <>
            <div className="meter" role="img" aria-label={`ใช้พื้นที่ ${view.volume.usedPercent}%`}>
              <span className={`meter-fill ${view.volume.level}`} style={{ width: `${Math.min(view.volume.usedPercent, 100)}%` }} />
              <span className="meter-mark" style={{ left: `${EXPAND_AT_PERCENT}%` }} title={`${EXPAND_AT_PERCENT}%`} />
              <span className="meter-mark" style={{ left: `${view.volume.maxUsePercent}%` }} title={`${view.volume.maxUsePercent}%`} />
            </div>
            <p>
              ใช้ {gb(view.volume.usedBytes)} จาก {gb(view.volume.totalBytes)} ({view.volume.usedPercent}%) · ว่าง {gb(view.volume.freeBytes)} ·{" "}
              <span className={VOLUME[view.volume.level].className}>{VOLUME[view.volume.level].text}</span>
            </p>
            <p className="muted">
              ดิสก์นี้ใช้ร่วมกับ replica HOSxP ซึ่งได้สิทธิ์ก่อน เมื่อเกิน {view.volume.maxUsePercent}% ระบบลบไฟล์เก่าสุดเองโดยเก็บไฟล์ล่าสุด {view.keepMin} ไฟล์ไว้เสมอ
              {view.inboxPending > 0 && ` · กำลังรับไฟล์ใหม่ ${view.inboxPending} รายการ`}
            </p>
          </>
        )}
      </div>

      {view.days.length > 0 && (
        <div className="card" aria-labelledby="days-heading">
          <h2 id="days-heading">ไฟล์รายวันบน GDCC</h2>
          <p className={missing ? "state-bad" : "muted"}>
            {missing ? `ขาด ${missing} วัน ในช่วงที่ยังเก็บไฟล์อยู่` : "ครบทุกวันในช่วงที่ยังเก็บไฟล์อยู่"}
          </p>
          <ul className="days">
            {view.days.map((d) => (
              <li key={d.date} className={`day ${d.state}`}>
                <span>{thaiDay(d.date)}</span>
                <strong>{d.state === "present" ? "มีไฟล์" : d.state === "pending" ? "รอไฟล์วันนี้" : "ไม่มีไฟล์"}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card table-wrap">
        <h2>ไฟล์ที่เก็บบน GDCC</h2>
        <table>
          <thead>
            <tr><th>วันที่ backup</th><th>ชื่อไฟล์</th><th>ขนาด</th><th>checksum</th><th>ถึง GDCC</th><th>การเก็บ</th></tr>
          </thead>
          <tbody>
            {view.files.map((f) => {
              const pending = open.get(f.name);
              return (
                <tr key={f.name}>
                  <td>{thaiDay(f.backupDate)}</td>
                  <td><code>{f.name}</code></td>
                  <td className={f.small ? "state-bad" : undefined}>
                    {gb(f.sizeBytes)}
                    {f.small && <div>เล็กผิดปกติ</div>}
                  </td>
                  <td className={f.checksum === "verified" ? "state-ok" : "state-warn"}>
                    {f.checksum === "verified" ? "ตรงตอนรับไฟล์" : "ไม่มีไฟล์ checksum"}
                  </td>
                  <td>{formatBangkok(f.modifiedAt)}</td>
                  <td>
                    {f.protected ? (
                      <span className="muted">ไฟล์ล่าสุด เก็บไว้เสมอ</span>
                    ) : pending ? (
                      <span className={REQUEST[pending.status].className}>{REQUEST[pending.status].text}</span>
                    ) : canPropose ? (
                      <details>
                        <summary>ขอทำลายไฟล์นี้</summary>
                        <form className="stack" action={proposeDestroyAction}>
                          {csrf}
                          <input type="hidden" name="fileName" value={f.name} />
                          <label>เหตุผล<textarea name="reason" rows={2} required minLength={10} maxLength={500} /></label>
                          <label>
                            <input type="checkbox" name="confirm" required /> เข้าใจว่าเมื่อได้รับอนุมัติและพ้นช่วงพักรอ ไฟล์นี้จะถูกทำลายถาวรและกู้คืนไม่ได้
                          </label>
                          <button type="submit">ส่งคำขอทำลาย</button>
                        </form>
                      </details>
                    ) : (
                      <span className="muted">เก็บไว้</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {view.files.length === 0 && (
              <tr><td colSpan={6} className={view.state === "fresh" ? "state-bad" : "muted"}>{view.state === "fresh" ? "ไม่มีไฟล์ backup บน GDCC" : "ไม่มีข้อมูล"}</td></tr>
            )}
          </tbody>
        </table>
        {!backupFiles.enabled && configured && <p className="muted">คำขอทำลายไฟล์ยังไม่เปิดใช้ (ต้องตั้ง GDCC_FILES_REQUESTS_OUTBOX)</p>}
      </div>

      <div className="card table-wrap">
        <h2>คำขอจัดการไฟล์</h2>
        <table>
          <thead>
            <tr><th>ไฟล์</th><th>สถานะ</th><th>ผู้เสนอ / เหตุผล</th><th>ผู้พิจารณา</th><th></th></tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <RequestRow key={r.id} request={r} userId={session.user.id} isAdmin={isAdmin} csrf={csrf} />
            ))}
            {requests.length === 0 && <tr><td colSpan={5} className="muted">ยังไม่มีคำขอ</td></tr>}
          </tbody>
        </table>
      </div>

      {(view.pruned.length > 0 || view.corrupt.length > 0) && (
        <div className="card">
          <h2>เหตุการณ์จาก GDCC</h2>
          <ul>
            {view.pruned.slice(0, 10).map((p) => (
              <li key={`p-${p.file}-${p.at.toISOString()}`}>{formatBangkok(p.at)} ลบอัตโนมัติเพราะพื้นที่เกินเกณฑ์: <code>{p.file}</code></li>
            ))}
            {view.corrupt.slice(0, 10).map((c) => (
              <li key={`c-${c.file}-${c.at.toISOString()}`} className="state-bad">{formatBangkok(c.at)} checksum ไม่ตรง ไฟล์ถูกทิ้ง รอส่งใหม่: <code>{c.file}</code></li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

const NAS_STATE: Record<NasView["state"], { text: string; className: string }> = {
  fresh: { text: "รอบล่าสุดทำงานปกติ", className: "state-ok" },
  failed: { text: "รอบล่าสุดล้มเหลว", className: "state-bad" },
  stale: { text: "ไม่ได้รับรายงาน", className: "state-bad" },
  unavailable: { text: "ไม่มีข้อมูลจาก NAS", className: "state-bad" },
};

function NasSection({ nas }: { nas: NasView }) {
  const state = NAS_STATE[nas.state];
  const missing = nas.days.filter((d) => d.state === "missing").length;
  return (
    <>
      <h2 className="section-title">NAS ในโรงพยาบาล</h2>
      <div className="card" aria-labelledby="nas-heading">
        <h2 id="nas-heading">การเก็บไฟล์บน NAS</h2>
        <p>
          สถานะ: <strong className={state.className}>{state.text}</strong>
          {nas.generatedAt && <span className="muted"> · รายงานล่าสุด {formatBangkok(nas.generatedAt)} (เกณฑ์ {NAS_STALE_HOURS} ชม.)</span>}
        </p>
        {nas.error && <p className="card state-bad">{nas.error}</p>}
        {nas.state === "stale" && <p className="card state-bad">ไม่ได้รับรายงานจาก NAS เกิน {NAS_STALE_HOURS} ชั่วโมง ข้อมูลข้างล่างเป็นของรอบที่แล้ว ตรวจ scheduled task บน NAS และการส่งของเครื่อง HOSxP</p>}
        {nas.state === "unavailable" && <p className="muted">ยังไม่มีไฟล์สถานะจาก NAS (เครื่อง HOSxP ส่งมากับรอบ upload ไป GDCC)</p>}
        {nas.generatedAt && (
          <>
            <p>
              เก็บชุดล่าสุด <strong>{nas.keepCount}</strong> ชุด · มีครบ <strong className={nas.belowKeep ? "state-warn" : undefined}>{nas.completeSets}</strong> ชุด
              {nas.belowKeep && <span className="muted"> (น้อยกว่าที่กำหนด ระบบจะยังไม่ลบไฟล์ใด)</span>}
            </p>
            {nas.volume && (
              <>
                <div className="meter" role="img" aria-label={`NAS ใช้พื้นที่ ${nas.volume.usedPercent}%`}>
                  <span className={`meter-fill ${nas.volume.usedPercent > 90 ? "pruning" : nas.volume.usedPercent > 80 ? "expand" : "ok"}`} style={{ width: `${Math.min(nas.volume.usedPercent, 100)}%` }} />
                </div>
                <p>ใช้ {nas.volume.usedPercent}% · ว่าง {gb(nas.volume.freeBytes)} จาก {gb(nas.volume.totalBytes)}</p>
              </>
            )}
            {nas.days.length > 0 && (
              <>
                <p className={missing ? "state-bad" : "muted"}>{missing ? `ขาด ${missing} วัน ในช่วงที่เก็บอยู่` : "ครบทุกวันในช่วงที่เก็บอยู่"}</p>
                <ul className="days">
                  {nas.days.map((d) => (
                    <li key={d.date} className={`day ${d.state}`}>
                      <span>{thaiDay(d.date)}</span>
                      <strong>{d.state === "present" ? "มีชุดครบ" : "ไม่มีชุดครบ"}</strong>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
      {nas.sets.length > 0 && (
        <div className="card table-wrap">
          <h2>ชุดที่เก็บบน NAS</h2>
          <table>
            <thead><tr><th>วันที่ backup</th><th>ไฟล์ ZIP</th><th>ขนาด</th></tr></thead>
            <tbody>
              {nas.sets.map((set) => (
                <tr key={set.date + set.zipName}><td>{thaiDay(set.date)}</td><td><code>{set.zipName}</code></td><td>{gb(set.zipBytes)}</td></tr>
              ))}
            </tbody>
          </table>
          {nas.deletedFiles.length > 0 && (
            <p className="muted">
              รอบล่าสุดลบไฟล์เก่า {nas.deletedFiles.length} ไฟล์: {nas.deletedFiles.slice(0, 10).map((f) => <code key={f}>{f}</code>).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, " ", el] : [el]), [])}
            </p>
          )}
        </div>
      )}
    </>
  );
}

function RequestRow({ request: r, userId, isAdmin, csrf }: { request: BackupFileRequest; userId: string; isAdmin: boolean; csrf: React.ReactNode }) {
  const canDecide = isAdmin && r.status === "PROPOSED" && r.proposedById !== userId;
  const canCancel = (r.status === "PROPOSED" || r.status === "APPROVED") && (isAdmin || r.proposedById === userId);
  return (
    <tr>
      <td><code>{r.fileName}</code><div className="muted">{gb(r.sizeBytes)}</div></td>
      <td className={REQUEST[r.status].className}>
        {REQUEST[r.status].text}
        {r.status === "APPROVED" && r.holdUntil && <div className="muted">ส่งให้ GDCC หลัง {formatBangkok(r.holdUntil)}</div>}
        {r.outcome && OUTCOME[r.outcome] && <div className="muted">{OUTCOME[r.outcome]}</div>}
        {r.completedAt && <div className="muted">{formatBangkok(r.completedAt)}</div>}
      </td>
      <td>{r.proposedByLabel} · {formatBangkok(r.proposedAt)}<div className="muted">{r.reason}</div></td>
      <td>{r.decidedByLabel ? <>{r.decidedByLabel} · {formatBangkok(r.decidedAt)}{r.decisionNote && <div className="muted">{r.decisionNote}</div>}</> : "-"}</td>
      <td>
        {canDecide && (
          <details>
            <summary>พิจารณา</summary>
            <form className="stack">
              {csrf}
              <input type="hidden" name="id" value={r.id} />
              <label>หมายเหตุ<input name="note" maxLength={500} /></label>
              <label><input type="checkbox" name="confirm" required /> ตรวจชื่อไฟล์และเหตุผลแล้ว</label>
              <button type="submit" formAction={approveDestroyAction}>อนุมัติ (พักรอ {DELETION_HOLD_HOURS} ชม.)</button>
              <button type="submit" className="secondary" formAction={rejectDestroyAction}>ไม่อนุมัติ</button>
            </form>
          </details>
        )}
        {canCancel && (
          <details>
            <summary>ยกเลิกคำขอ</summary>
            <form className="stack" action={cancelDestroyAction}>
              {csrf}
              <input type="hidden" name="id" value={r.id} />
              <label>หมายเหตุ<input name="note" maxLength={500} /></label>
              <label><input type="checkbox" name="confirm" required /> ยกเลิก ไฟล์ยังเก็บไว้</label>
              <button type="submit" className="secondary">ยกเลิกคำขอ</button>
            </form>
          </details>
        )}
      </td>
    </tr>
  );
}
