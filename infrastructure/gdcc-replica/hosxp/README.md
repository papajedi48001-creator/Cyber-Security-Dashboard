# Replica ฐานข้อมูล hos ของ HOSxP บน GDCC

ตาม [ADR 0010](../../../docs/adr/0010-replicate-hosxp-database-to-gdcc.md) ทำสำเนาครั้งแรกด้วย `mariadb-dump --single-transaction` แทน mariabackup เพราะตาราง MyISAM ที่ถูกเขียนตลอด (ราว 80 GB) จะทำให้ HOSxP บันทึกข้อมูลไม่ได้ราว 30 นาทีถ้าใช้ mariabackup (ดิสก์เขียนได้ราว 42 MB/s วัดเมื่อ 27/11/2569) dump แบบนี้ไม่ใช้ global lock เลย แลกกับตาราง log แบบ MyISAM อาจคลาดเคลื่อนเล็กน้อยในแถวที่เปลี่ยนระหว่าง dump replica จึงไล่ข้อมูลด้วย `slave_exec_mode=IDEMPOTENT` แล้วสลับกลับเป็น `STRICT` เมื่อไล่ทัน

| สคริปต์ | รันที่ | หน้าที่ |
|---|---|---|
| `hos-replica-prepare.sh` | HOSxP | บัญชี `repl_gdcc@127.0.0.1` (REPLICATION SLAVE เท่านั้น), key และ service `gdcc-hosxp-tunnel` (ssh -R 127.0.0.1:3317 → 127.0.0.1:3306), ไฟล์ส่งต่อสำหรับ VM |
| `vm-replica-prepare.sh` | VM | บัญชี `hosxp-tunnel` เปิดได้แค่ remote forward 127.0.0.1:3317 ไม่มี shell ไม่มี -L เก็บรหัส replication ใน `/root/.hosxp-repl.pass` แล้วลบไฟล์ส่งต่อ |
| `hos-seed-dump.sh` | HOSxP | dump ฐาน hos (ไม่รวม `replicate_log%`) บีบอัดลงดิสก์ แล้วส่งเข้า inbox บน GDCC พร้อม SHA-256 และตำแหน่ง GTID |
| `vm-seed-load.sh` | VM | ตรวจ SHA-256 โหลดข้อมูล ตั้ง `gtid_slave_pos` แล้วเริ่ม connection `hosxp` |

ซ้อมกับ MariaDB 10.11 สองตัวในเครื่องทดสอบแล้ว (27/11/2569): ภาษาไทย tis620 และ blob ถูกต้อง, ตาราง `replicate_log%` ไม่ถูกคัดลอกทั้งใน dump และหลัง dump, ไล่ข้อมูลหลัง dump ทัน; tunnel รับเฉพาะพอร์ต 3317 ปฏิเสธพอร์ตอื่น คำสั่ง shell และ -L
