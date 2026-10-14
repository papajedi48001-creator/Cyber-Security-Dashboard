# Sophos Cutover Checklist

ลำดับการย้ายจาก FortiSIEM ไป Wazuh บนเครื่องเดิม (ADR 0005) ทุกขั้นบันทึกผลใน [sophos-cutover-record.md](./sophos-cutover-record.md)

## ก่อน rebuild

- [ ] Go/No-Go ใน [fortisiem-acceptance-record.md](./fortisiem-acceptance-record.md#go-no-go) เป็น GO และมีผู้อนุมัติ
- [ ] Image FortiSIEM กู้คืนได้ ([fortisiem-evidence-export-record.md](./fortisiem-evidence-export-record.md))
- [ ] Relay ติดตั้งและผ่าน test ([log-relay-runbook.md](./log-relay-runbook.md))
- [ ] ได้รับอนุมัติให้ชี้ Sophos มาที่ relay แล้วชี้แล้ว relay health = healthy
- [ ] แจ้งทีม IT ช่วงเวลาที่ SIEM จะหยุด และวิธีเฝ้าระวังด้วยตาระหว่างนั้น (Sophos dashboard)

## Rebuild และซ้อม

- [ ] บันทึก `log_gap.start` แล้ว rebuild ตาม [wazuh-all-in-one-runbook.md](./wazuh-all-in-one-runbook.md)
- [ ] Ingestion: event จาก Sophos (รวมที่ค้างใน buffer) เข้า `wazuh-archives-*`
- [ ] Detection: `logtest_check.py` ผ่านทุกข้อ และ `events_dropped` = 0 ระหว่างโหลดจริง
- [ ] Source health: หยุด relay forwarding ชั่วคราวแล้วเกิด alert 100181/100182
- [ ] Notification: alert ระดับ P1 ทดสอบส่ง email และ LINE OA ได้ (เมื่อ Portal พร้อม; ก่อนหน้านั้นใช้การแจ้งเตือนของ Wazuh ไปที่ email ทีม)
- [ ] Recovery: ซ้อมกู้ Wazuh จาก backup ตาม [siem-backup-recovery-runbook.md](./siem-backup-recovery-runbook.md) ภายใน 24 ชั่วโมง
- [ ] Rollback: ซ้อมกู้ image FortiSIEM (บนเครื่องชั่วคราว) และวิธีชี้ relay กลับ
- [ ] บันทึก `log_gap.end` เมื่อ Wazuh รับ log ปกติ

## ยอมรับใช้งานจริง

- [ ] `validate_cutover_record.py` ผ่าน
- [ ] ผู้มีอำนาจของโรงพยาบาลลงนามยอมรับ Wazuh เป็น SIEM หลัก
- [ ] ระหว่างนี้เก็บ image FortiSIEM ไว้ตามกำหนด retention
