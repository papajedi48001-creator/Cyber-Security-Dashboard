# สำเนาไฟล์ backup รายวันของ HOSxP ขึ้น GDCC

ส่งไฟล์ `MySQL_backup_*.ZIP` ที่ระบบ backup ของ HOSxP สร้างทุกคืน ขึ้นไปเก็บบน VM ใน GDCC และลบไฟล์เก่าอัตโนมัติเมื่อพื้นที่ใกล้เต็ม ([ADR 0010](../../docs/adr/0010-replicate-hosxp-database-to-gdcc.md))

| ไฟล์ | หน้าที่ |
|---|---|
| `hosxp_offsite.py upload` | รันบนเครื่อง HOSxP: ส่งไฟล์ที่เขียนเสร็จแล้ว (เก่ากว่า 30 นาที ภายใน 2 วันล่าสุด) ที่ยังไม่เคยส่ง ผ่าน SFTP พร้อมไฟล์ SHA-256 เขียนชื่อขึ้นต้นด้วยจุดแล้วค่อยเปลี่ยนชื่อเมื่อครบ และเขียน Backup Evidence (`hosxp-daily-zip`) ลง outbox |
| `hosxp_offsite.py store` | รันบน VM GDCC ทุก 10 นาที: ตรวจ SHA-256 แล้วย้ายเข้าโฟลเดอร์ที่มีแต่ root อ่านได้ จากนั้นถ้าดิสก์เข้ารหัสใช้เกิน 85% ลบไฟล์เก่าสุดทีละไฟล์ โดยเก็บไฟล์ล่าสุดไว้อย่างน้อย 2 ไฟล์ |
| `nas_backup_retention.py` | รันบน NAS (Synology Task Scheduler วันละครั้ง 04:45 น.): เก็บ backup ล่าสุดที่สมบูรณ์ 15 ชุด (ZIP + log) ลบชุดที่เก่ากว่านั้น แล้วเขียนไฟล์สถานะ `hosxp-nas-status.json` |
| `hosxp_offsite.py upload --nas-status` | ส่งไฟล์สถานะของ NAS ขึ้น GDCC ทุกรอบ (แม้ไม่มี ZIP ใหม่) เพื่อให้หน้า backup ของ Portal แสดงฝั่ง NAS คู่กับฝั่ง GDCC แบบดูอย่างเดียว |
| `sshd-hosxp-upload.conf.example` | บัญชี `hosxp-upload` ใช้ได้แค่ SFTP ใน chroot ที่มีโฟลเดอร์ `inbox` เท่านั้น อ่านหรือลบไฟล์ที่เก็บแล้วไม่ได้ |
| `systemd/*.example` | upload 05:00, 08:00, 12:00 น. (รอบหลังส่งเฉพาะไฟล์ที่ยังไม่ถึง) และ store ทุก 10 นาที |

## กติกาสำคัญ

- ไฟล์ที่เล็กกว่าครึ่งหนึ่งของค่ากลาง 7 ไฟล์ล่าสุด หรือเล็กกว่า 1 GiB จะไม่ถูกส่ง และบันทึกเป็น FAILED เพราะแปลว่า backup คืนนั้นเสีย (เช่นไฟล์ 56 KB ของวันที่ 25/11/2569)
- ไฟล์ที่อ่านสารบัญ ZIP ไม่ได้ (backup หยุดกลางคันจนไฟล์ขาดท้าย) จะไม่ถูกส่งเช่นกัน และบันทึกเป็น FAILED
- ไฟล์ตารางข้างใน ZIP ตั้งรหัสผ่านไว้โดยโปรแกรม backup ของ HOSxP (ตรวจแล้ว 27/11/2569: 7,050 ไฟล์) จึงตรวจเนื้อในไม่ได้หากไม่มีรหัสผ่าน **ห้ามเก็บรหัสผ่านนี้ไว้บน VM GDCC** ให้เก็บแยกในที่ปลอดภัยของโรงพยาบาล เพราะถ้าหายจะกู้คืนจากไฟล์บน GDCC ไม่ได้
- ไฟล์ backup มีข้อมูลผู้ป่วย: บน GDCC เก็บในดิสก์เข้ารหัส LUKS (`/srv/secure`) ร่วมกับ replica และส่งผ่าน SSH เท่านั้น
- เมื่อดิสก์ถูกล็อก (หลังรีบูตก่อนรัน `replica-unlock`) การส่งจะล้มเหลวและบันทึก FAILED แล้วส่งใหม่รอบถัดไป
- log และ evidence ไม่มีที่อยู่ GDCC หรือ path ของ key
- สร้าง Backup Job ชื่อ `hosxp-daily-zip` ในหน้า Backup ของ Portal (ปลายทาง `GDCC`, รอบ 24 ชม.) ก่อนส่ง evidence เข้า Portal

## เก็บ backup บน NAS 15 ชุด

เครื่อง HOSxP mount share ของ NAS แบบอ่านอย่างเดียว การลบไฟล์เก่าจึงต้องรันบน NAS เอง

กติกาการลบ:

- นับเฉพาะชุดที่ ZIP อ่านสารบัญได้ (สมบูรณ์) ไฟล์เสียแบบวันที่ 25/11/2569 ไม่นับรวม 15 ชุด ไฟล์ดีจึงไม่ถูกลบแทนไฟล์เสีย
- ถ้าชุดที่สมบูรณ์มีน้อยกว่า 15 ชุด จะไม่ลบอะไรเลย
- ไฟล์ที่เพิ่งถูกแก้ภายใน 60 นาที (backup ยังเขียนอยู่) ไม่นับและไม่ลบ
- ลบเฉพาะไฟล์ชื่อ `MySQL_backup_*.ZIP` และ `MySQL_backup_*_log.txt` ในโฟลเดอร์นั้นเท่านั้น ไม่แตะโฟลเดอร์ย่อยหรือไฟล์อื่น
- Portal ไม่มีปุ่มลบหรือสั่ง backup จำนวนชุดที่เก็บตั้งที่ `--keep` ใน Task Scheduler เท่านั้น
- ถ้าไฟล์สถานะไม่ถูกส่งมาเกิน 26 ชม. Portal แสดงเป็น "ข้อมูลเก่า" ไม่ใช่ "ปกติ"

ติดตั้งบน Synology (DSM 7 มี `python3` มาให้แล้ว):

1. Control Panel > Shared Folder > Create ชื่อ `ops_scripts` บน volume เดียวกับ `HOSxP_Backup` ให้เฉพาะ administrators เข้าได้ ไม่เปิด NFS/SMB ให้คนอื่น
2. File Station: อัปโหลด `nas_backup_retention.py` เข้า `ops_scripts`
3. Control Panel > Task Scheduler > Create > Scheduled Task > User-defined script, User: `root`, Schedule: ทุกวัน 04:45, Task Settings > Run command:

   ```bash
   python3 /volume2/ops_scripts/nas_backup_retention.py --folder /volume2/HOSxP_Backup/HOSxP_Backup_Daily --status /volume2/HOSxP_Backup/HOSxP_Backup_Daily/hosxp-nas-status.json --keep 15 --dry-run
   ```

   รันครั้งแรกด้วย `--dry-run` (ไม่ลบจริง) แล้วดู `deleted_files` ในไฟล์สถานะ ถ้าถูกต้องค่อยเอา `--dry-run` ออก
4. บนเครื่อง HOSxP เพิ่ม `--nas-status /mnt/mariadb-migration-ro/HOSxP_Backup_Daily/hosxp-nas-status.json` ให้ `hosxp-offsite-upload.service` (ดู `systemd/hosxp-offsite-upload.service.example`)

## ทดสอบ

```bash
python3 -m unittest discover -s infrastructure/gdcc-hosxp-files/tests -v
```
