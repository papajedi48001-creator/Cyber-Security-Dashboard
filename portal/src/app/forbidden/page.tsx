import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <main>
      <div className="card">
        <h1>ไม่มีสิทธิ์เข้าถึง</h1>
        <p>บัญชีของคุณไม่มีสิทธิ์ในหน้านี้ หรือการยืนยันคำขอไม่ถูกต้อง</p>
        <Link href="/">กลับหน้าหลัก</Link>
      </div>
    </main>
  );
}
