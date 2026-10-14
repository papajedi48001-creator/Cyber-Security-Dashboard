# Sophos Cutover Checklist

ลำดับการเพิ่ม Wazuh บน VM ใหม่ควบคู่กับ FortiSIEM (ADR 0008) FortiSIEM ยังรับ log ตามเดิมตลอด ทุกขั้นบันทึกผลใน [sophos-cutover-record.md](./sophos-cutover-record.md)

## ก่อนเพิ่มปลายทาง Syslog

- [ ] Go/No-Go ใน [fortisiem-acceptance-record.md](./fortisiem-acceptance-record.md#go-no-go) เป็น GO และมีผู้อนุมัติ
- [ ] Wazuh VM ติดตั้งตาม [wazuh-all-in-one-runbook.md](./wazuh-all-in-one-runbook.md) และ `logtest_check.py` ผ่าน
- [ ] Relay ติดตั้งและผ่าน test ([log-relay-runbook.md](./log-relay-runbook.md))
- [ ] บันทึกค่าปลายทาง Syslog เดิมของ Sophos ที่ส่งไป FortiSIEM (ห้ามแก้ค่านี้)

## เพิ่มปลายทางและซ้อม

- [ ] ได้รับอนุมัติแล้วเพิ่ม relay เป็นปลายทาง Syslog ที่สองใน Sophos บันทึก `log_gap.start` เป็นเวลาที่เริ่มตั้งค่า
- [ ] ตรวจว่า FortiSIEM ยังได้รับ log ตามปกติหลังเพิ่มปลายทาง
- [ ] บันทึก `log_gap.end` เมื่อ Wazuh เริ่มได้รับ log จาก Sophos
- [ ] Ingestion: event จาก Sophos เข้า `wazuh-archives-*`
- [ ] Detection: `logtest_check.py` ผ่านทุกข้อ และ `events_dropped` = 0 ระหว่างโหลดจริง
- [ ] Source health: หยุด relay forwarding ชั่วคราวแล้วเกิด alert 100181/100182
- [ ] Notification: alert ระดับ P1 ทดสอบส่ง email และ LINE OA ได้ (เมื่อ Portal พร้อม; ก่อนหน้านั้นใช้การแจ้งเตือนของ Wazuh ไปที่ email ทีม)
- [ ] Recovery: ซ้อมกู้ Wazuh จาก backup ตาม [siem-backup-recovery-runbook.md](./siem-backup-recovery-runbook.md) ภายใน 24 ชั่วโมง
- [ ] Rollback: ซ้อมลบปลายทางที่สองออกจาก Sophos แล้วตรวจว่า FortiSIEM ไม่ได้รับผลกระทบ

## ยอมรับใช้งานจริง

- [ ] `validate_cutover_record.py` ผ่าน
- [ ] ผู้มีอำนาจของโรงพยาบาลลงนามยอมรับ Wazuh เป็น SIEM หลัก
- [ ] การปลด FortiSIEM (ถ้ามี) เป็นการตัดสินใจแยก ต้องทำ [fortisiem-evidence-export-record.md](./fortisiem-evidence-export-record.md) ก่อน
