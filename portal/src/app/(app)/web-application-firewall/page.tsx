import { formatBangkok } from "@/lib/format";
import { getServices } from "@/lib/server/context";
import { requirePageSession } from "@/lib/server/session";

const STATUS_CLASS = { fresh: "state-ok", stale: "state-warn", error: "state-bad", unavailable: "state-bad" } as const;

function Top({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  return (
    <div className="card table-wrap">
      <h2>{title}</h2>
      <table>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}><td>{r.label}</td><td>{r.count.toLocaleString("th-TH")}</td></tr>
          ))}
          {rows.length === 0 && <tr><td className="muted">ไม่มีข้อมูลในช่วงนี้</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export default async function WafPage() {
  const session = await requirePageSession("evidence.read");
  const s = await getServices().waf.getSampledWafSummary(session.user);
  const max = Math.max(1, ...s.trend.map((t) => t.count));

  return (
    <>
      <h1>Cloudflare WAF (ข้อมูลสุ่มตัวอย่าง)</h1>
      <p className="card state-warn" role="note">
        Cloudflare แผน Free ให้ข้อมูลเหตุการณ์แบบสุ่มตัวอย่าง (sampled) ใช้ดูแนวโน้มและคัดแยกความผิดปกติเท่านั้น ไม่ใช่บันทึกคำขอเว็บครบทุกครั้ง
        และไม่ใช้เป็นหลักฐานว่าไม่มีการโจมตี
      </p>
      <div className="card">
        <strong>สถานะข้อมูล: </strong>
        <span className={STATUS_CLASS[s.status]}>{s.reason}</span>
        {s.range && (
          <div className="muted">
            ช่วงเวลา {formatBangkok(s.range.since)} ถึง {formatBangkok(s.range.until)} · ดึงเมื่อ {formatBangkok(s.fetchedAt)}
          </div>
        )}
        {s.lastError && <div className="error">ข้อผิดพลาดล่าสุด: {s.lastError}</div>}
      </div>
      {s.total === null ? (
        <p className="card state-bad">ยังไม่ทราบจำนวนเหตุการณ์ (ไม่ใช่ศูนย์)</p>
      ) : (
        <>
          <div className="card">
            <h2>เหตุการณ์ที่สุ่มได้ใน 24 ชั่วโมง: {s.total.toLocaleString("th-TH")}</h2>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 80 }} aria-label="แนวโน้มรายชั่วโมง">
              {s.trend.map((t) => (
                <div
                  key={t.hour}
                  title={`${formatBangkok(new Date(t.hour))}: ${t.count}`}
                  style={{ flex: 1, height: `${(t.count / max) * 100}%`, background: "var(--accent)", minHeight: 1 }}
                />
              ))}
            </div>
          </div>
          <Top title="การกระทำ (block / challenge)" rows={s.actions.map((a) => ({ label: a.action, count: a.count }))} />
          <Top title="Path ที่ถูกกระทำบ่อย" rows={s.topPaths.map((p) => ({ label: p.path, count: p.count }))} />
          <Top title="ประเทศต้นทาง" rows={s.countries.map((c) => ({ label: c.country, count: c.count }))} />
          <Top title="กลไกที่ตรวจจับ" rows={s.sources.map((c) => ({ label: c.source, count: c.count }))} />
        </>
      )}
    </>
  );
}
