import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MFA_CHALLENGE_COOKIE } from "@/lib/auth/provider-id";
import { MfaForm } from "./MfaForm";

export const dynamic = "force-dynamic";

export default async function MfaPage() {
  if (!(await cookies()).has(MFA_CHALLENGE_COOKIE)) redirect("/login");
  return (
    <main>
      <div className="card" style={{ maxWidth: 460, margin: "48px auto" }}>
        <h1>ยืนยัน MFA ของ Portal</h1>
        <p className="muted">ยืนยันตัวตนด้วย Provider ID แล้ว กรอกรหัสจากแอป Authenticator ภายใน 5 นาที กรอกผิดต้องเริ่มใหม่</p>
        <MfaForm />
      </div>
    </main>
  );
}
