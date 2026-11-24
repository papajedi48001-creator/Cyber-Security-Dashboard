import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main>
      <div className="card login-card">
        <div className="brand login-brand">
          <span className="brand-mark" aria-hidden="true">W</span>
          <span>Waritchaphum Security Dashboard</span>
        </div>
        <p className="muted">โรงพยาบาลวาริชภูมิ · ใช้ได้เฉพาะเครือข่ายบริหารจัดการหรือ VPN ที่มี MFA</p>
        <LoginForm />
      </div>
    </main>
  );
}
