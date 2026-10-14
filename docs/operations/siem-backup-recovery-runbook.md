# SIEM Backup and Recovery Runbook

เป้าหมาย: กู้ Wazuh all-in-one และข้อมูลที่จำเป็นได้ภายใน 24 ชั่วโมง (SIEM Recovery Objective) ยอมรับว่า log อาจขาดช่วงระหว่างกู้ (relay จะ buffer ให้เท่าที่พื้นที่พอ) ระบบนี้ไม่ใช่ high availability

> Backup Job Success ไม่ได้ยืนยันว่ากู้คืนได้ ต้องซ้อมกู้จริงตามรอบข้างล่างและบันทึกผล

## สิ่งที่ต้องสำรอง

| รายการ | ที่อยู่ | ความถี่ | วิธี |
|---|---|---|---|
| Config ของ manager | `/var/ossec/etc/` (ossec.conf, rules, decoders, client.keys) | ทุกวันและทุกครั้งที่แก้ | tar + เข้ารหัส |
| Certificate และ keystore | `/etc/wazuh-indexer/certs`, `/etc/wazuh-dashboard/certs`, `/etc/filebeat/certs`, indexer keystore | ทุกครั้งที่เปลี่ยน | tar + เข้ารหัส |
| Security config ของ indexer | export ด้วย `securityadmin.sh -backup` | ทุกสัปดาห์และทุกครั้งที่เปลี่ยนผู้ใช้/role | เข้ารหัส |
| Index ข้อมูล | snapshot repository `gdcc-archive` | ทุกวัน (snapshot ล่าสุด) + lifecycle | [log-archive-runbook.md](./log-archive-runbook.md) |
| ISM policy, index template | export ผ่าน API | ทุกครั้งที่เปลี่ยน | เก็บใน repo นี้ |

Backup ทั้งหมดเข้ารหัสก่อนส่ง GDCC กุญแจเก็บใน Secrets Vault และกู้ได้ด้วย Dual-Control Key Recovery (อย่างน้อย 2 คน) เท่านั้น ห้ามเก็บกุญแจไว้บนเครื่อง Wazuh หรือพื้นที่เดียวกับ backup

## ลำดับการกู้คืน

1. บันทึกเวลาเริ่ม และแจ้งทีมว่า SIEM หยุด (เฝ้าระวังด้วย Sophos dashboard ชั่วคราว)
2. เตรียม VM (Wazuh VM เดิมหรือ VM ใหม่) ติดตั้ง OS และ Wazuh รุ่นเดียวกับที่บันทึกใน inventory
3. ผู้ถือกุญแจสองคนร่วมกันถอดรหัส backup ตามขั้นตอน Dual-Control Key Recovery
4. คืน certificate และ keystore แล้ว config ของ manager
5. คืน security config ของ indexer ด้วย `securityadmin.sh`
6. ลงทะเบียน snapshot repository แล้ว restore index ช่วงล่าสุดที่จำเป็นต่อการทำงาน (alerts 7–30 วันล่าสุด) ส่วนที่เหลือ restore ภายหลังได้
7. ติดตั้ง ISM policy และ index template กลับ
8. ตรวจ: `logtest_check.py` ผ่าน, relay ส่ง buffer เข้ามาครบ (health = healthy), Portal ดึง alert ได้, dashboard login ได้
9. บันทึกเวลาสิ้นสุดและช่วงที่ log ขาดหาย

## ซ้อมกู้คืน

- ทุก 6 เดือน และหลังเปลี่ยนรุ่น Wazuh
- ซ้อมบนเครื่องชั่วคราว ห้ามกู้ทับระบบที่ใช้งานจริง
- บันทึกเวลาที่ใช้จริงของแต่ละขั้น ถ้ารวมเกิน 24 ชั่วโมง ให้แก้ runbook หรือเพิ่มทรัพยากรแล้วซ้อมใหม่

| วันที่ | ผู้ซ้อม | เวลาที่ใช้ (ชม.) | ผล | ปัญหาที่พบ |
|---|---|---|---|---|
| | | | | |

## Rollback ไป FortiSIEM

FortiSIEM ยังทำงานและรับ log ตามเดิม (ADR 0008) ถ้าต้องกลับไปใช้ FortiSIEM อย่างเดียว ให้ลบปลายทาง Syslog ที่สองออกจาก Sophos ตาม [log-relay-runbook.md](./log-relay-runbook.md#rollback) ไม่ต้องกู้คืน image
