import { getServices } from "@/lib/server/context";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

const PROVIDER_ID_MESSAGES: Record<string, string> = {
  bad_request: "คำขอเข้าสู่ระบบด้วย Provider ID ไม่ถูกต้องหรือหมดอายุ กรุณาเริ่มใหม่",
  provider_unavailable: "Provider ID ใช้งานไม่ได้ชั่วคราว ใช้ชื่อผู้ใช้และรหัสผ่านของ Portal แทน",
  provider_rejected: "Provider ID ไม่ยืนยันตัวตน กรุณาลองใหม่",
  wrong_hospital: "Provider ID นี้ไม่ได้สังกัดโรงพยาบาลนี้",
  not_linked: "Provider ID นี้ยังไม่ได้ผูกกับบัญชี Portal ติดต่อ Security Administrator",
  invalid_credentials: "บัญชีนี้ถูกปิดใช้งาน ถูกล็อกชั่วคราว หรือยังไม่ได้ลงทะเบียน MFA",
  mfa_failed: "รหัส MFA ไม่ถูกต้องหรือหมดเวลา กรุณาเข้าสู่ระบบด้วย Provider ID ใหม่",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ provider_id?: string }> }) {
  const { provider_id: reason } = await searchParams;
  const providerIdEnabled = getServices().providerId !== null;
  const message = reason ? PROVIDER_ID_MESSAGES[reason] : undefined;
  return (
    <main>
      <div className="card" style={{ maxWidth: 460, margin: "48px auto" }}>
        <h1>Security Operations Portal</h1>
        <p className="muted">โรงพยาบาลวาริชภูมิ · ใช้ได้เฉพาะเครือข่ายบริหารจัดการหรือ VPN ที่มี MFA</p>
        {message && (
          <p className="error" role="alert">
            {message}
          </p>
        )}
        {providerIdEnabled && (
          <p>
            <a href="/login/provider-id/start">
              เข้าสู่ระบบด้วย Provider ID
            </a>
          </p>
        )}
        <LoginForm />
      </div>
    </main>
  );
}
