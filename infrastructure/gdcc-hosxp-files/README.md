# สำเนาไฟล์ backup รายวันของ HOSxP ขึ้น GDCC

ส่งไฟล์ `MySQL_backup_*.ZIP` ที่ระบบ backup ของ HOSxP สร้างทุกคืน ขึ้นไปเก็บบน VM ใน GDCC และลบไฟล์เก่าอัตโนมัติเมื่อพื้นที่ใกล้เต็ม ([ADR 0010](../../docs/adr/0010-replicate-hosxp-database-to-gdcc.md))

| ไฟล์ | หน้าที่ |
|---|---|
| `hosxp_offsite.py upload` | รันบนเครื่อง HOSxP: ส่งไฟล์ที่เขียนเสร็จแล้ว (เก่ากว่า 30 นาที ภายใน 2 วันล่าสุด) ที่ยังไม่เคยส่ง ผ่าน SFTP พร้อมไฟล์ SHA-256 เขียนชื่อขึ้นต้นด้วยจุดแล้วค่อยเปลี่ยนชื่อเมื่อครบ และเขียน Backup Evidence (`hosxp-daily-zip`) ลง outbox |
| `hosxp_offsite.py store` | รันบน VM GDCC ทุก 10 นาที: ตรวจ SHA-256 แล้วย้ายเข้าโฟลเดอร์ที่มีแต่ root อ่านได้ จากนั้นถ้าดิสก์เข้ารหัสใช้เกิน 85% ลบไฟล์เก่าสุดทีละไฟล์ โดยเก็บไฟล์ล่าสุดไว้อย่างน้อย 2 ไฟล์ |
| `sshd-hosxp-upload.conf.example` | บัญชี `hosxp-upload` ใช้ได้แค่ SFTP ใน chroot ที่มีโฟลเดอร์ `inbox` เท่านั้น อ่านหรือลบไฟล์ที่เก็บแล้วไม่ได้ |
| `systemd/*.example` | upload 05:00, 08:00, 12:00 น. (รอบหลังส่งเฉพาะไฟล์ที่ยังไม่ถึง) และ store ทุก 10 นาที |

## กติกาสำคัญ

- ไฟล์ที่เล็กกว่าครึ่งหนึ่งของค่ากลาง 7 ไฟล์ล่าสุด หรือเล็กกว่า 1 GiB จะไม่ถูกส่ง และบันทึกเป็น FAILED เพราะแปลว่า backup คืนนั้นเสีย (เช่นไฟล์ 56 KB ของวันที่ 25/11/2569)
- ไฟล์ backup มีข้อมูลผู้ป่วย: บน GDCC เก็บในดิสก์เข้ารหัส LUKS (`/srv/secure`) ร่วมกับ replica และส่งผ่าน SSH เท่านั้น
- เมื่อดิสก์ถูกล็อก (หลังรีบูตก่อนรัน `replica-unlock`) การส่งจะล้มเหลวและบันทึก FAILED แล้วส่งใหม่รอบถัดไป
- log และ evidence ไม่มีที่อยู่ GDCC หรือ path ของ key
- สร้าง Backup Job ชื่อ `hosxp-daily-zip` ในหน้า Backup ของ Portal (ปลายทาง `GDCC`, รอบ 24 ชม.) ก่อนส่ง evidence เข้า Portal

## ทดสอบ

```bash
python3 -m unittest discover -s infrastructure/gdcc-hosxp-files/tests -v
```
