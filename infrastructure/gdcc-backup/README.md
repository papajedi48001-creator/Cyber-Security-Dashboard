# GDCC Backup

สำรองข้อมูลแบบเข้ารหัสไป GDCC ด้วย restic และส่งผลเป็น Backup Evidence ให้ Portal ([ADR 0009](../../docs/adr/0009-gdcc-offsite-backup-and-portal-db-replica.md))
ขั้นตอนติดตั้งและกู้คืนอยู่ใน [GDCC runbook](../../docs/operations/gdcc-backup-and-replica-runbook.md)

| ไฟล์ | หน้าที่ |
|---|---|
| `gdcc_backup.py` | `backup`: รัน pre-command แล้ว `restic backup` ทีละงาน เขียน evidence CSV ลง outbox · `prune`: ลบ snapshot ตาม retention และตรวจข้อมูลบางส่วน (รันบนเครื่อง maintenance เท่านั้น) |
| `jobs.example.toml` | ตัวอย่างงานของ Portal Application Server |
| `gdcc-backup.env.example` | ชื่อตัวแปร repository และ credential (ค่าจริงอยู่ใน Secrets Vault) |
| `dump-portal-db.sh` | dump Portal MariaDB แบบ consistent ก่อน backup |
| `systemd/*.example` | service และ timer รายวัน 01:30 น. เวลาไทย |

## งานของแต่ละเครื่อง

ชื่องานต้องตรงกับ Backup Job ที่สร้างในหน้า Backup ของ Portal (ปลายทาง `GDCC`, รอบ 24 ชม.)

| เครื่อง | ชื่องาน | paths |
|---|---|---|
| Portal Application Server | `portal-mariadb-daily` | `/var/backups/portal-db` (จาก `dump-portal-db.sh`) |
| | `portal-config-daily` | `/opt/portal` ยกเว้น `.env`, `node_modules` |
| Wazuh VM | `wazuh-config-daily` | `/var/ossec/etc`, `/var/ossec/etc/shared` |
| | `wazuh-certs-daily` | `/etc/wazuh-indexer/certs`, `/etc/wazuh-dashboard/certs`, `/etc/filebeat/certs`, `/etc/wazuh-indexer/opensearch.keystore` |
| | `wazuh-security-config-daily` | ไดเรกทอรีผลของ `securityadmin.sh -backup` (pre-command) |
| TLS Log Relay | `log-relay-config-daily` | `/etc/syslog-ng`, certificate ของ relay, `allowed-sources` |

Index ของ Wazuh ไม่ผ่านเครื่องมือนี้ ใช้ snapshot repository `gdcc-archive` ตาม [log-archive-runbook.md](../../docs/operations/log-archive-runbook.md)

## ความปลอดภัย

- restic เข้ารหัสฝั่งเครื่องก่อนส่งออก รหัส repository อ่านจาก `RESTIC_PASSWORD_FILE` เท่านั้น สคริปต์ปฏิเสธ `RESTIC_PASSWORD`
- แต่ละเครื่องมี repository และ credential ของตัวเอง credential บนเครื่องเป็นแบบเขียนอย่างเดียว ส่วน `prune` ใช้ credential แยกบนเครื่อง maintenance
- log และ evidence ไม่มี credential หรือที่อยู่ repository

## ทดสอบ

```bash
python3 -m unittest discover -s infrastructure/gdcc-backup/tests -v
```
