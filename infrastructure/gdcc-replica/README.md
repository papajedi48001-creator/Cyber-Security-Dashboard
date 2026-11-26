# GDCC Portal Database Replica

MariaDB replica ของฐานข้อมูล Portal บน VM ใน GDCC แบบอ่านอย่างเดียว ([ADR 0009](../../docs/adr/0009-gdcc-offsite-backup-and-portal-db-replica.md))
ขั้นตอนติดตั้ง ตรวจสอบ และ promote อยู่ใน [GDCC runbook](../../docs/operations/gdcc-backup-and-replica-runbook.md)

| ไฟล์ | ใช้ที่ |
|---|---|
| `primary.cnf.example` | Portal MariaDB (โรงพยาบาล): binary log แบบ ROW + GTID, TLS |
| `replica.cnf.example` | MariaDB บน VM ใน GDCC: read-only, เฉพาะฐาน `portal`, ฟังเฉพาะ 127.0.0.1 |
| `setup-replica.sql.example` | บัญชี `repl` (REQUIRE SSL), `CHANGE MASTER` แบบตรวจ certificate, บัญชี `portal-monitor` |
| `systemd/gdcc-replica-tunnel.service.example` | SSH reverse tunnel จาก Portal server ออกไป GDCC (ใช้เมื่อไม่มี site-to-site VPN) |
| `authorized_keys.example` | จำกัด key ของ tunnel ให้เปิดได้แค่สอง forward ไม่มี shell |
| `lab/run-lab.sh` | ซ้อมครบวงจรบนเครื่องเดียว: replicate ผ่าน tunnel + TLS, read-only, monitor, ตัด tunnel แล้วตามทัน |

## เส้นทางเครือข่าย

1. **site-to-site IPSec (แนะนำระยะยาว)**: `MASTER_HOST` เป็นชื่อ VPN ของ primary พอร์ต 3306 ไม่ต้องใช้ tunnel
2. **SSH reverse tunnel**: Portal server ต่อออกไป VM ใน GDCC ทาง 22 เท่านั้น โรงพยาบาลไม่เปิดพอร์ตรับเข้า ต้องให้ GDCC เปิด 22 เฉพาะ public IP ของโรงพยาบาล
3. **openfortivpn บน Portal server**: เมื่อ GDCC ให้เข้าผ่าน SSL-VPN เท่านั้น ต้องใช้บัญชี VPN ของเครื่อง ไม่ใช้บัญชีบุคคล

ห้ามเปิด 3306 ของฝั่งใดออก Internet

## ทดสอบ

```bash
python3 -m unittest discover -s infrastructure/gdcc-replica/tests -v
sudo infrastructure/gdcc-replica/lab/run-lab.sh            # ต้องมี mariadb-server, openssh-server, autossh
sudo PORTAL_DIR=$PWD/portal infrastructure/gdcc-replica/lab/run-lab.sh   # รวมตรวจ replica monitor ของ Portal
```
