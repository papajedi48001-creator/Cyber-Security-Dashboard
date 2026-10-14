# FortiSIEM Acceptance Record

บันทึกผลการทดสอบรับมอบตาม [fortisiem-handover-checklist.md](./fortisiem-handover-checklist.md)

## ผลการทดสอบ

| # | เวลา (Asia/Bangkok) | ผู้ทดสอบ | ผลที่ได้จริง | ผ่าน/ไม่ผ่าน/ยังไม่ทดสอบ | หลักฐานอ้างอิง | ปัญหาที่ขวาง |
|---|---|---|---|---|---|---|
| A1 | | | | ยังไม่ทดสอบ | | |
| A2 | | | | ยังไม่ทดสอบ | | |
| A3 | | | | ยังไม่ทดสอบ | | |
| A4 | | | | ยังไม่ทดสอบ | | |
| A5 | | | | ยังไม่ทดสอบ | | |
| A6 | | | | ยังไม่ทดสอบ | | |
| A7 | | | | ยังไม่ทดสอบ | | |

## Go/No-Go

เงื่อนไขที่ต้องครบก่อนติดตั้ง Wazuh แทนที่บน Existing SIEM Server:

- [ ] ทุกแถวข้างบนผ่าน หรือมีเหตุผลยอมรับความเสี่ยงที่ลงนามแล้ว
- [ ] [siem-capacity-baseline.md](./siem-capacity-baseline.md) ระบุว่าเครื่องผ่านขั้นต่ำของ Wazuh all-in-one
- [ ] [fortisiem-evidence-export-record.md](./fortisiem-evidence-export-record.md) ยืนยันว่า image กู้คืนได้จริง
- [ ] TLS Log Relay รับ Sophos log อยู่แล้ว (แผน 1 Task 2)

| รายการ | ค่า |
|---|---|
| ผลตัดสินใจ | GO / NO-GO |
| เหตุผล | |
| ผู้อนุมัติการ rebuild (ชื่อ ตำแหน่ง) | |
| วันที่อนุมัติ | |
| ช่วงเวลาที่วางแผนหยุด FortiSIEM | |
