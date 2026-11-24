import { requireModulePage } from "@/lib/server/session";

export default async function ReplicaPage() {
  await requireModulePage("db-replica");
  return (
    <>
      <h1>MariaDB Replica</h1>
      <div className="card">
        <p>
          <span className="pill off">รอข้อมูล</span>
        </p>
        <p>ยังไม่มีคู่ master/replica ที่ส่งรายงานเข้ามา หน้านี้จะแสดงเปอร์เซ็นต์ข้อมูล replica เทียบ master สถานะการทำสำเนา และตารางเปรียบเทียบฐานข้อมูล เมื่อติดตั้ง Replica Reporter แล้ว</p>
        <p className="muted">โมดูลนี้อ่านอย่างเดียว ไม่มีปุ่มเริ่ม หยุด หรือสลับ replica</p>
      </div>
    </>
  );
}
