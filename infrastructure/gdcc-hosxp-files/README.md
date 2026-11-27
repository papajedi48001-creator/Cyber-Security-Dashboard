# สำเนาไฟล์ backup รายวันของ HOSxP ขึ้น GDCC

ส่งไฟล์ `MySQL_backup_*.ZIP` ที่ระบบ backup ของ HOSxP สร้างทุกคืน ขึ้นไปเก็บบน VM ใน GDCC และลบไฟล์เก่าอัตโนมัติเมื่อพื้นที่ใกล้เต็ม ([ADR 0010](../../docs/adr/0010-replicate-hosxp-database-to-gdcc.md))

| ไฟล์ | หน้าที่ |
|---|---|
| `hosxp_offsite.py upload` | รันบนเครื่อง HOSxP: ส่งไฟล์ที่เขียนเสร็จแล้ว (เก่ากว่า 30 นาที ภายใน 2 วันล่าสุด) ที่ยังไม่เคยส่ง ผ่าน SFTP พร้อมไฟล์ SHA-256 เขียนชื่อขึ้นต้นด้วยจุดแล้วค่อยเปลี่ยนชื่อเมื่อครบ และเขียน Backup Evidence (`hosxp-daily-zip`) ลง outbox |
| `hosxp_offsite.py store` | รันบน VM GDCC ทุก 10 นาที: ตรวจ SHA-256 แล้วย้ายเข้าโฟลเดอร์ที่มีแต่ root อ่านได้ ทำคำขอทำลายไฟล์ที่ Portal อนุมัติและพ้นช่วงพักรอแล้ว จากนั้นถ้าดิสก์เข้ารหัสใช้เกิน 85% ลบไฟล์เก่าสุดทีละไฟล์ โดยเก็บไฟล์ล่าสุดไว้อย่างน้อย 2 ไฟล์ สุดท้ายเขียนไฟล์สถานะให้ Portal |
| `hosxp_offsite.py sync` | รันบน Portal server ทุก 5 นาที: ส่งคำขอที่พ้นช่วงพักรอไปที่ GDCC และดึงไฟล์สถานะกลับมา ([ADR 0011](../../docs/adr/0011-manage-hosxp-backup-files-on-gdcc.md)) |
| `sshd-hosxp-upload.conf.example` | บัญชี `hosxp-upload` ใช้ได้แค่ SFTP ใน chroot ที่มีโฟลเดอร์ `inbox` เท่านั้น อ่านหรือลบไฟล์ที่เก็บแล้วไม่ได้ |
| `systemd/*.example` | upload 05:00, 08:00, 12:00 น. (รอบหลังส่งเฉพาะไฟล์ที่ยังไม่ถึง), store ทุก 10 นาที และ `portal-gdcc-files-sync` บน Portal server ทุก 5 นาที |

## กติกาสำคัญ

- ไฟล์ที่เล็กกว่าครึ่งหนึ่งของค่ากลาง 7 ไฟล์ล่าสุด หรือเล็กกว่า 1 GiB จะไม่ถูกส่ง และบันทึกเป็น FAILED เพราะแปลว่า backup คืนนั้นเสีย (เช่นไฟล์ 56 KB ของวันที่ 25/11/2569)
- ไฟล์ที่อ่านสารบัญ ZIP ไม่ได้ (backup หยุดกลางคันจนไฟล์ขาดท้าย) จะไม่ถูกส่งเช่นกัน และบันทึกเป็น FAILED
- ไฟล์ตารางข้างใน ZIP ตั้งรหัสผ่านไว้โดยโปรแกรม backup ของ HOSxP (ตรวจแล้ว 27/11/2569: 7,050 ไฟล์) จึงตรวจเนื้อในไม่ได้หากไม่มีรหัสผ่าน **ห้ามเก็บรหัสผ่านนี้ไว้บน VM GDCC** ให้เก็บแยกในที่ปลอดภัยของโรงพยาบาล เพราะถ้าหายจะกู้คืนจากไฟล์บน GDCC ไม่ได้
- ไฟล์ backup มีข้อมูลผู้ป่วย: บน GDCC เก็บในดิสก์เข้ารหัส LUKS (`/srv/secure`) ร่วมกับ replica และส่งผ่าน SSH เท่านั้น
- เมื่อดิสก์ถูกล็อก (หลังรีบูตก่อนรัน `replica-unlock`) การส่งจะล้มเหลวและบันทึก FAILED แล้วส่งใหม่รอบถัดไป
- log และ evidence ไม่มีที่อยู่ GDCC หรือ path ของ key
- สร้าง Backup Job ชื่อ `hosxp-daily-zip` ในหน้า Backup ของ Portal (ปลายทาง `GDCC`, รอบ 24 ชม.) ก่อนส่ง evidence เข้า Portal

## หน้าไฟล์ backup ใน Portal (ADR 0011)

หน้า **ไฟล์ Backup HOSxP** (`/backups/files`) แสดงสองส่วนในหน้าเดียว

**NAS ในโรงพยาบาล** (ดูอย่างเดียว): scheduled task บน NAS เก็บชุดล่าสุด 15 ชุดและลบที่เหลือเอง แล้วเขียนไฟล์สถานะ เครื่อง HOSxP ส่งไฟล์นี้ขึ้น GDCC เป็น `/inbox/hosxp-nas-status.json` ทุกรอบ store ย้ายไปไว้ที่ `status/nas-status.json` และ sync ดึงมาไว้ข้าง `status.json` ของ Portal หน้าแสดงจำนวนชุดที่มี วันที่ขาด พื้นที่ NAS ผลรอบล่าสุด และไฟล์ที่ถูกลบ ถ้าไม่ได้รับรายงานเกิน 26 ชั่วโมงจะขึ้นว่า "ไม่ได้รับรายงาน"

**สำเนาบน GDCC**: แสดงไฟล์ที่เก็บอยู่ ขนาด ผลตรวจ checksum วันที่ขาดไฟล์ พื้นที่ดิสก์ และไฟล์ที่ระบบลบอัตโนมัติ ข้อมูลมาจากไฟล์สถานะที่ store เขียน ถ้าไม่ได้รับเกิน 30 นาทีจะขึ้นว่า "ข้อมูลไม่เป็นปัจจุบัน"

การทำลายไฟล์ก่อนถึงเกณฑ์ลบอัตโนมัติ:

1. Security Operator หรือ Administrator กด "ขอทำลายไฟล์นี้" ใส่เหตุผล และติ๊กยืนยัน (ไฟล์ล่าสุด 2 ไฟล์ขอไม่ได้)
2. Security Administrator **อีกคน** อนุมัติหรือไม่อนุมัติ
3. หลังอนุมัติมีช่วงพักรอ 24 ชั่วโมง ผู้เสนอหรือ Administrator ยกเลิกได้ตลอดช่วงนี้
4. พ้นช่วงพักรอ worker เขียนคำขอลง outbox แล้ว sync ส่งไป GDCC
5. store บน GDCC ตรวจซ้ำ (ชื่อไฟล์ ขนาด ไม่ใช่ไฟล์ล่าสุด และเวลาพักรอ) แล้วจึงลบ ผลกลับมาในไฟล์สถานะและบันทึกในคำขอ

Portal ไม่ต่อ GDCC เอง บัญชี `portal-ops` บน VM ใช้ได้แค่ SFTP ใน `/srv/secure/ops`: อ่าน `status/status.json` และเขียนลง `requests/` เท่านั้น มองไม่เห็นไฟล์ backup

ติดตั้ง (ต้องได้รับอนุมัติจากโรงพยาบาลก่อน เพราะเป็นการเปลี่ยนแปลง production):

1. VM GDCC: รัน `gdcc-vm-setup.sh` เวอร์ชันนี้ (สร้าง `portal-ops`, `/srv/secure/ops` และเพิ่มตัวเลือกให้ store)
2. Portal server: `ssh-keygen -t ed25519 -f /etc/portal-gdcc-files/portal-ops_ed25519 -N ''` ให้ผู้ใช้ `portal` อ่านได้ แล้วนำ public key ไปใส่ `/home/portal-ops/.ssh/authorized_keys` บน VM และเพิ่ม host key ของ VM ใน `known_hosts` ของผู้ใช้ `portal`
3. Portal server: สร้าง `/var/spool/portal/gdcc-requests` และ `/var/lib/portal/gdcc-files` (เจ้าของ `portal`) ติดตั้ง `portal-gdcc-files-sync.service/.timer` จาก `systemd/*.example` (แก้ `GDCC_VM_ADDRESS`)
4. `.env` ของ Portal: `GDCC_FILES_STATUS_PATH=/var/lib/portal/gdcc-files/status.json` และถ้าจะเปิดคำขอทำลาย `GDCC_FILES_REQUESTS_OUTBOX=/var/spool/portal/gdcc-requests` จากนั้น restart web และ worker
5. ถ้ายังไม่ตั้ง `GDCC_FILES_REQUESTS_OUTBOX` หน้านี้ดูได้อย่างเดียว

## ทดสอบ

```bash
python3 -m unittest discover -s infrastructure/gdcc-hosxp-files/tests -v
```
