# GDCC Backup และ Replica Runbook

สำรองข้อมูลแบบเข้ารหัสไป GDCC และ MariaDB replica ของฐานข้อมูล Portal ตาม [ADR 0009](../adr/0009-gdcc-offsite-backup-and-portal-db-replica.md) และ [design](../superpowers/specs/2026-11-26-gdcc-offsite-backup-design.md)

> ทุกขั้นที่ติดตั้งหรือเปลี่ยนค่าบนเครื่องจริงหรือใน GDCC เป็น production change ต้องได้รับอนุมัติจากโรงพยาบาลก่อน
> Replica ไม่ใช่ HA ไม่สลับอัตโนมัติ และไม่ใช้แทน backup เพราะการลบหรือข้อมูลเสียจะถูกคัดลอกไปทันที

| เป้าหมาย | RPO | RTO |
|---|---|---|
| ฐานข้อมูล Portal (replica) | ไม่กี่นาที (เตือนเมื่อล่าช้าเกิน 5 นาที) | 24 ชม. |
| ฐานข้อมูล Portal (backup) | 24 ชม. | 24 ชม. |
| Wazuh config, certificate, security config | 24 ชม. | 24 ชม. |

## 0. วันแรกที่ได้รับ GDCC (ทำก่อนทุกอย่าง)

ข้อ 1–3 และการเตรียมบัญชี `tunnel` ทำได้ด้วยสคริปต์เดียว [`vm-first-day.sh`](../../infrastructure/gdcc-replica/vm-first-day.sh) (รันบน VM เป็น root ใน session ที่เปิดค้างไว้):

```bash
sudo bash vm-first-day.sh <ชื่อผู้ดูแล> "<SSH public key ของผู้ดูแล>"            # เพิ่ม --with-mariadb เพื่อติดตั้ง replica
```

สคริปต์พิมพ์รหัส root ใหม่ครั้งเดียว ให้เก็บใน Secrets Vault ทันที แล้วทดสอบ login ด้วยบัญชีใหม่ในหน้าต่างใหม่ก่อนปิด session เดิม

1. เปลี่ยนรหัส root ที่ GDCC ส่งมา: `passwd root` ใช้รหัสสุ่ม 20 ตัวขึ้นไป (`openssl rand -base64 24`) เก็บใน Secrets Vault ทันที
2. สร้างบัญชีผู้ดูแลแบบระบุตัวคน (`adduser <ชื่อ>`, `usermod -aG sudo <ชื่อ>`) พร้อม SSH public key
3. ทดสอบ login ด้วยบัญชีใหม่ในหน้าต่างใหม่ก่อน แล้วตั้ง `PermitRootLogin no` และ `PasswordAuthentication no` ใน `/etc/ssh/sshd_config` แล้ว `systemctl reload ssh` (RHEL/Rocky ใช้ `sshd`)
4. หมุนเปลี่ยน credential เริ่มต้นของ object storage หรือบริการอื่นที่ GDCC ส่งมาในหน้า portal ของ GDCC
5. เปิด disk encryption (LUKS) ให้ volume ที่จะเก็บข้อมูล replica และติดตั้ง security update
   - VM ของโรงพยาบาลใช้ไฟล์เข้ารหัสก้อนเดียว `/srv/secure.img` (440G) ร่วมกันระหว่าง replica และไฟล์ backup ของ HOSxP ตั้งค่าด้วย [`gdcc-vm-setup.sh`](../../infrastructure/gdcc-hosxp-files/gdcc-vm-setup.sh) และหลังรีบูตรัน `sudo replica-unlock` ขั้นตอนด้านล่างเป็นแบบทั่วไปสำหรับ VM อื่น
   - ถ้า VM มีดิสก์ข้อมูลแยก ให้เข้ารหัสทั้งดิสก์นั้น ถ้ามีแค่ดิสก์ระบบ (เช่น root เป็น XFS ซึ่งย่อไม่ได้) ใช้ไฟล์เข้ารหัสบน root แทน:

     ```bash
     sudo dnf -y install cryptsetup
     sudo fallocate -l 380G /srv/replica.img   # Portal อย่างเดียวใช้ 100G พอ; รวม HOSxP (ADR 0010) ใช้ 380G && sudo chmod 600 /srv/replica.img
     sudo cryptsetup luksFormat --type luks2 /srv/replica.img   # รหัสปลดล็อกเก็บใน Secrets Vault
     sudo cryptsetup open /srv/replica.img replica
     sudo mkfs.xfs /dev/mapper/replica
     sudo mkdir -p /var/lib/mysql && sudo mount /dev/mapper/replica /var/lib/mysql
     sudo restorecon -R /var/lib/mysql
     ```

   - ไม่ใส่ใน `/etc/fstab` หรือ `/etc/crypttab` เพื่อให้เครื่องบูตได้โดยไม่ต้องใส่รหัส หลังรีบูตผู้ดูแลปลดล็อกเอง: `sudo cryptsetup open /srv/replica.img replica && sudo mount /dev/mapper/replica /var/lib/mysql && sudo systemctl start mariadb` ระหว่างนั้นหน้า Portal แสดง replica เป็น unavailable
   - ตั้ง MariaDB ไม่ให้เริ่มเองตอนบูต (`sudo systemctl disable mariadb`) เพื่อไม่ให้สร้างฐานข้อมูลเปล่าบนดิสก์ที่ยังไม่ปลดล็อก
   - repository ของ restic ไม่ต้องใช้ LUKS เพราะเข้ารหัสจากฝั่งโรงพยาบาลแล้ว
   - ปิด web console ที่เปิดรับรหัสผ่านจากอินเทอร์เน็ต: `sudo systemctl disable --now cockpit.socket`
6. บันทึกในตารางท้าย runbook: บริการที่ได้รับ (object storage/VM/DB), โควตา, เส้นทางเครือข่าย, และ GDCC รองรับ credential แบบเขียนอย่างเดียวหรือ object lock หรือไม่

## 1. เส้นทางเครือข่าย

| ทาง | ใช้เมื่อ | ต้องขอ |
|---|---|---|
| site-to-site IPSec (Sophos ↔ GDCC) | ระยะยาว และถ้าจะใช้ GDCC กับระบบอื่นเช่น HOSxP | GDCC + อนุมัติเปลี่ยนค่า Sophos |
| SSH reverse tunnel จาก Portal server | ยังไม่มี VPN และ VM มี public IP | GDCC เปิด TCP 22 เฉพาะ public IP ของโรงพยาบาล, Sophos อนุญาตขาออก |
| openfortivpn บน Portal server | GDCC ให้เข้าผ่าน SSL-VPN เท่านั้น | บัญชี VPN สำหรับเครื่อง (ไม่ใช่บัญชีบุคคล ไม่ใช้ MFA แบบกดยืนยัน) |

FortiClient บนเครื่องผู้ดูแลใช้สำหรับเข้าไปดูแล VM เท่านั้น ห้ามใช้เป็นเส้นทาง replicate เพราะหยุดเมื่อปิดเครื่อง

ตรวจเส้นทางจากเครื่องในโรงพยาบาล (ไม่ต่อ FortiClient):

```bash
timeout 5 bash -c '</dev/tcp/<GDCC_VM_IP>/22' && echo 22 open || echo 22 closed
```

ผลตรวจ 2026-11-26 จากเครื่องในโรงพยาบาล: พอร์ต 22 ปิด (timeout) และ 443 ตอบ no route to host จึงยังใช้ tunnel ไม่ได้จนกว่า GDCC จะเปิดพอร์ตหรือทำ VPN

ห้ามเปิดพอร์ต 3306 ของฝั่งใดออก Internet

## 2. Backup แบบเข้ารหัสไป GDCC

ติดตั้งบนทุกเครื่องตาม [infrastructure/gdcc-backup/README.md](../../infrastructure/gdcc-backup/README.md)

1. ติดตั้ง restic (แพ็กเกจของ distro) และ `rsync`
2. สร้าง repository แยกต่อเครื่อง (`portal`, `wazuh`, `log-relay`) และ credential แยกต่อเครื่อง ถ้า GDCC รองรับ ให้ credential บนเครื่องเป็นแบบเขียนอย่างเดียว
3. สร้างรหัส repository: `openssl rand -base64 32 > /etc/gdcc-backup/restic-password && chmod 400 ...` แล้ว `restic init`
4. **ฝากกุญแจ**: เก็บรหัส repository ใน Secrets Vault แบบ Dual-Control Key Recovery (อย่างน้อย 2 คน) ก่อนเริ่ม backup ครั้งแรก ถ้ากุญแจหาย backup ทั้งหมดใช้ไม่ได้
5. คัดลอก `jobs.example.toml`, `gdcc-backup.env.example`, `dump-portal-db.sh` และ systemd unit ไปตำแหน่งจริง ใส่ค่าจาก Secrets Vault แล้ว `systemctl enable --now gdcc-backup.timer`
6. บน Portal: Security Administrator สร้าง Backup Job ชื่อเดียวกับใน `jobs.toml` ปลายทาง `GDCC` รอบ 24 ชม.
7. รันครั้งแรกด้วยมือ `systemctl start gdcc-backup.service` แล้วดู `journalctl -u gdcc-backup` และหน้า Backup ของ Portal
8. เครื่อง maintenance (credential ที่ลบได้) ตั้ง timer รายสัปดาห์ให้รัน `gdcc_backup.py prune --config ...` ต่อ repository

### ส่งผล backup เข้า Portal

- Portal server: ตั้ง `BACKUP_EVIDENCE_INBOX=/var/spool/portal/backup-evidence` ใน `.env` และให้ `--outbox` ของเครื่องนี้ชี้ไปที่ inbox
- เครื่องอื่น: `ExecStopPost` ใน service ส่งไฟล์ด้วย `rsync` ไปบัญชี `evidence` บน Portal server ซึ่งจำกัด key ให้เขียนได้เฉพาะ inbox (`command="rrsync -wo /var/spool/portal/backup-evidence",restrict`)
- worker นำเข้าทุก 5 นาทีแล้วย้ายไฟล์ไป `processed/` บรรทัดที่ชื่องานไม่ตรงจะถูกปฏิเสธและนับใน audit
- ถ้าเครื่องไหนหยุดส่ง Portal จะขึ้น "ขาดรอบ" เอง

## 3. ตั้ง Portal MariaDB replica

ไฟล์อยู่ใน [infrastructure/gdcc-replica/](../../infrastructure/gdcc-replica/README.md)

1. **อนุมัติ** การเปิด binary log บน Portal MariaDB (ต้อง restart)
2. ออก certificate จาก CA ภายในให้ primary ชื่อ `portal-db-primary` (และ SAN ของชื่อ VPN ถ้าใช้ VPN) ติดตั้ง `primary.cnf.example` แล้ว restart MariaDB
3. บน VM ใน GDCC: ติดตั้ง MariaDB รุ่นเดียวกัน, `replica.cnf.example`, CA certificate, และเพิ่ม `127.0.0.1 portal-db-primary` ใน `/etc/hosts` (กรณี tunnel)
4. กรณี tunnel: สร้างบัญชี `tunnel` แบบไม่มี shell บน VM ใส่ key ตาม `authorized_keys.example` (ต้องมี `command="/bin/false"`) และบน Portal server ติดตั้ง `autossh` และ `gdcc-replica-tunnel.service`
5. สร้างบัญชี `repl` บน primary ตาม `setup-replica.sql.example` (รหัสจาก Secrets Vault)
6. seed: `mariadb-dump --single-transaction --gtid --master-data=1 --databases portal` แล้วโหลดบน replica
7. `CHANGE MASTER TO ...` แล้ว `START SLAVE` และสร้างบัญชี `portal-monitor`
8. ตั้ง `PORTAL_REPLICA_MONITOR_URL=mysql://portal-monitor:<รหัส>@127.0.0.1:3316/` บน Portal แล้ว restart worker
   - ถ้า VM ใช้ multi-source (connection `portal` และ `hosxp` ตาม `hosxp-replica.cnf.example`) ตั้งเพิ่ม `PORTAL_REPLICA_CONNECTION=portal` และ `HOSXP_REPLICA_CONNECTION=hosxp` หน้า Backup จะแสดง replica แยกเป็น 2 การ์ด และเปิด incident P3 แยกกัน (`portal-db-replica`, `hosxp-db-replica`)
   - ถ้าตั้งชื่อ connection ผิด หรือ connection ยังไม่ถูกสร้าง สถานะจะเป็น "เชื่อมต่อไม่ได้" ไม่ใช่ "ทำงานปกติ"
9. ตรวจหน้า Backup ของ Portal ว่า replica "ทำงานปกติ" และเพิ่ม incident ทดสอบแล้วดูว่าขึ้นบน replica

## 4. เฝ้าระวัง

| สถานะในหน้า Backup | ความหมาย | ทำอะไร |
|---|---|---|
| ทำงานปกติ | สอง thread ทำงาน ล่าช้า ≤ 300 วินาที | - |
| ล่าช้า | ล่าช้าเกิน 300 วินาทีหรือไม่ทราบ | ดูเครือข่ายและโหลดของ VM |
| หยุดทำงาน | replication thread หยุดหรือมี error | ดู `SHOW SLAVE STATUS\G` บน replica |
| เชื่อมต่อไม่ได้ | tunnel/VPN หลุด หรือ replica ล่ม | `systemctl status gdcc-replica-tunnel`, ตรวจ VM |
| ไม่ทราบสถานะ | worker ไม่ได้ตรวจเกิน 15 นาที | ตรวจ worker ของ Portal |

ผิดปกติติดกัน 2 รอบ (10 นาที) worker เปิด incident P3 หมวด `replica_health` ให้อัตโนมัติ
binary log บน primary เก็บ 7 วัน ถ้า replica ขาดนานกว่านั้นต้อง seed ใหม่ตามข้อ 3.6

ไฟล์ backup รายวันของ HOSxP บน GDCC ดูได้ที่หน้า **ไฟล์ Backup GDCC** ของ Portal: ขนาด, checksum, วันที่ขาดไฟล์ และพื้นที่ดิสก์ (เกิน 75% ขอพื้นที่เพิ่มจาก GDCC, เกิน 85% ระบบลบไฟล์เก่าสุดเอง) การทำลายไฟล์ก่อนเวลาต้องผ่านคำขอ ผู้อนุมัติอีกคน และช่วงพักรอ 24 ชั่วโมง ดูการติดตั้งใน [gdcc-hosxp-files](../../infrastructure/gdcc-hosxp-files/README.md#หน้าไฟล์-backup-ใน-portal-adr-0011)

## 5. ซ้อมกู้คืน

ทุก 90 วันต่องาน บนเครื่องชั่วคราวเท่านั้น ห้ามกู้ทับระบบจริง

1. ผู้ถือกุญแจสองคนเปิดรหัส repository ตาม Dual-Control Key Recovery
2. `restic snapshots --tag job=<งาน>` แล้ว `restic restore latest --tag job=<งาน> --target /restore-test`
3. ฐานข้อมูล Portal: โหลด `portal.sql.gz` ลง MariaDB ชั่วคราว นับจำนวนแถวของตารางหลักเทียบกับ replica
4. Wazuh: ทำตาม [siem-backup-recovery-runbook.md](./siem-backup-recovery-runbook.md)
5. บันทึกผลในหน้า Backup → "บันทึกผลทดสอบกู้คืน" อ้างอิงรายงาน (ไม่แนบข้อมูลจริง)

ซ้อม replica ด้วย `infrastructure/gdcc-replica/lab/run-lab.sh` บนเครื่องทดสอบได้ทุกครั้งที่เปลี่ยน config

## 6. Promote replica (เมื่อ Portal server เสียหาย)

ต้องได้รับอนุมัติจากโรงพยาบาล และยืนยันว่า primary เดิมหยุดเขียนแล้ว ห้ามมีสอง primary พร้อมกัน

1. บน replica: `STOP SLAVE; RESET SLAVE ALL; SET GLOBAL read_only = OFF;` และแก้ `read_only = OFF` ใน config
2. สร้างบัญชีแอปของ Portal บนเครื่องนี้ (รหัสใหม่จาก Secrets Vault)
3. สร้าง Portal Application Server ใหม่ (ในโรงพยาบาลหรือ GDCC) ชี้ `DATABASE_URL` มาที่เครื่องนี้ ผ่าน VPN หรือ tunnel
   - **ทางฉุกเฉิน (break-glass)** เมื่อ tunnel และ VPN ใช้ไม่ได้: ขอ GDCC เปิด 3306 ของ VM ให้เฉพาะ public IP ของโรงพยาบาลชั่วคราว ตั้ง `bind_address` ให้ฟังบน interface ภายนอก บัญชีแอปต้อง `REQUIRE X509` (client certificate จาก CA ของเรา) และผูกกับ IP ของโรงพยาบาล บันทึกเวลาเปิด และปิดพอร์ตทันทีเมื่อกลับมาใช้ VPN/tunnel หรือ primary ใหม่พร้อม
   - ช่วงปกติพอร์ต 3306 ที่ GDCC ต้องปิดเสมอ การ replicate ไม่ใช้พอร์ตนี้
4. ตรวจ login, incident ล่าสุด และ audit log
5. primary เดิมต้องสร้างใหม่เป็น replica ของเครื่องนี้ ห้ามเปิดกลับมาเป็นตัวเขียน
6. บันทึกเวลาเริ่ม-สิ้นสุด ข้อมูลที่ขาดหาย และเปิด incident สำหรับเหตุการณ์นี้

## บันทึกบริการ GDCC

| วันที่ | บริการ | รายละเอียด (ไม่ใส่ credential หรือ IP) | ผู้บันทึก |
|---|---|---|---|
| | | | |
