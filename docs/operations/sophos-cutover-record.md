# Sophos Cutover Record

บันทึกหลักฐานการซ้อมและการย้าย Sophos log เข้า Wazuh ตาม [sophos-cutover-checklist.md](./sophos-cutover-checklist.md) กรอกช่อง Value ให้ครบ แล้วตรวจด้วย

```bash
python3 docs/operations/tests/validate_cutover_record.py docs/operations/sophos-cutover-record.md
```

ช่องผลลัพธ์ใช้ `pass` หรือ `fail` เวลาใช้รูปแบบ ISO 8601 พร้อม timezone เช่น `2026-11-02T01:00+07:00` ห้ามใส่รหัสผ่าน IP จริง หรือข้อมูลผู้ป่วย ให้อ้างอิงไฟล์หลักฐานแทน

## การอนุมัติ

| Field | Value |
|---|---|
| `approval.approver` | |
| `approval.date` | |
| `approval.reference` | |

## การซ้อมด้วย event จำลอง

| Field | Value |
|---|---|
| `rehearsal.date` | |
| `ingestion.result` | |
| `ingestion.evidence` | |
| `detection.result` | |
| `detection.evidence` | |
| `detection.events_dropped` | |
| `source_health.result` | |
| `source_health.evidence` | |
| `notification.result` | |
| `notification.evidence` | |

## การกู้คืนและ rollback

| Field | Value |
|---|---|
| `recovery.elapsed_hours` | |
| `recovery.evidence` | |
| `rollback.method` | |
| `rollback.tested` | |
| `rollback.elapsed_hours` | |

## ช่วงที่ Wazuh ยังไม่ได้รับ log (ระหว่างเพิ่มปลายทาง Syslog)

| Field | Value |
|---|---|
| `log_gap.start` | |
| `log_gap.end` | |
