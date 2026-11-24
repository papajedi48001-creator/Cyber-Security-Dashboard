import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="login">
      <div className="card">
        <h1>Waritchaphum Security Dashboard</h1>
        <p className="muted">โรงพยาบาลวาริชภูมิ · ใช้ได้เฉพาะเครือข่ายบริหารจัดการหรือ VPN ที่มี MFA</p>
        <LoginForm />
      </div>
    </main>
  );
}
