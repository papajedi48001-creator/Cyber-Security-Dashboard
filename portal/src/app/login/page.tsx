import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main>
      <div className="card" style={{ maxWidth: 460, margin: "48px auto" }}>
        <h1>Security Operations Portal</h1>
        <p className="muted">โรงพยาบาลวาริชภูมิ · ใช้ได้เฉพาะเครือข่ายบริหารจัดการหรือ VPN ที่มี MFA</p>
        <LoginForm />
      </div>
    </main>
  );
}
