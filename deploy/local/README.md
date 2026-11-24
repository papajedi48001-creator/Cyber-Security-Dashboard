# ติดตั้ง Portal ใน Docker บนเครื่องเดียว (ทดสอบ)

ชุดนี้ใช้ติดตั้ง Security Operations Portal (ชื่อที่ผู้ใช้เห็นคือ Waritchaphum Security Dashboard) บนเครื่องเดียวเพื่อทดลองใช้งาน ไม่ใช่การติดตั้งจริงบน Portal Application Server ตาม ADR 0004

มีบริการ 3 ตัว คือ ฐานข้อมูล MariaDB 10.11, Portal และ nginx เปิดเว็บที่ `http://localhost:8080` และรับเฉพาะการเชื่อมต่อจากเครื่องนี้เท่านั้น ส่วน worker ที่ดึง alert จาก Wazuh ปิดไว้ก่อนจนกว่าจะมีบัญชี Wazuh ที่ใช้งานได้จริง

## สิ่งที่ต้องมี

- Docker Desktop (Windows) หรือ Docker Engine กับ Docker Compose v2
- git

## ติดตั้ง

Windows (PowerShell):

```powershell
git clone https://github.com/papajedi48001-creator/Cyber-Security-Dashboard.git
cd Cyber-Security-Dashboard\deploy\local
powershell -ExecutionPolicy Bypass -File .\setup.ps1   # สร้าง .env.docker และสุ่มรหัสผ่านให้
docker compose up -d --build
```

Linux หรือ macOS: ใช้ `./setup.sh` แทน `setup.ps1`

ครั้งแรกจะ build นานหลายนาที เมื่อ `docker compose ps` แสดงว่า portal ทำงานแล้วก็เปิดเว็บได้

ถ้าพอร์ต 8080 มีโปรแกรมอื่นใช้อยู่แล้ว (เช่น BlueStacks) ให้เปลี่ยนพอร์ตตอนเปิดระบบ เช่น `$env:PORTAL_PORT=8088; docker compose up -d` ใน PowerShell หรือ `PORTAL_PORT=8088 docker compose up -d` ใน Linux แล้วเปิดเว็บที่พอร์ตนั้นแทน

ค่า `WAZUH_*` และ `TRUSTED_NETWORKS` ใน `.env.docker` ต้องมีค่าเสมอ ถ้าว่างเว็บจะไม่ยอมเริ่มทำงาน ไฟล์ตัวอย่างใส่ค่าสมมติไว้ให้แล้ว

## สร้างผู้ดูแลระบบคนแรก

```powershell
docker compose exec portal npx tsx scripts/create-admin.ts
```

ใส่ชื่อผู้ใช้ ชื่อที่แสดง และรหัสผ่าน (อย่างน้อย 12 ตัวอักษร) จากนั้นนำ secret ที่แสดงไปลงในแอป authenticator เช่น Google Authenticator ทันที เพราะระบบแสดง secret นี้ครั้งเดียว แล้วเข้าสู่ระบบที่ `http://localhost:8080` ด้วยรหัสผ่านและรหัส 6 หลัก

## ใช้งานประจำ

| ต้องการ | คำสั่ง |
|---|---|
| ดูสถานะ | `docker compose ps` |
| ดู log ของเว็บ | `docker compose logs -f portal` |
| หยุด | `docker compose stop` |
| เริ่มใหม่ | `docker compose start` |
| อัปเดตเป็นโค้ดล่าสุด | `git pull` แล้ว `docker compose up -d --build` |
| เปิด worker (เมื่อมีบัญชี Wazuh แล้ว) | แก้ค่า `WAZUH_*` ใน `.env.docker` แล้ว `docker compose --profile worker up -d` |
| ลบทั้งหมดรวมฐานข้อมูล | `docker compose down -v` (ข้อมูลใน Portal หายถาวร) |

## ข้อควรรู้

- `.env.docker` เก็บรหัสผ่านฐานข้อมูลและกุญแจของระบบ ห้ามส่งต่อหรือ commit เข้า git (ไฟล์นี้ถูก ignore ไว้แล้ว)
- ยังไม่ได้ต่อ Wazuh, LINE หรืออีเมล หน้าแหล่ง log จึงแสดงเป็น "ข้อมูลเก่า" ซึ่งเป็นพฤติกรรมที่ถูกต้อง
- เว็บใช้ cookie แบบ secure เบราว์เซอร์ยอมให้ใช้กับ `localhost` ผ่าน http ได้ แต่ถ้าจะเปิดจากเครื่องอื่นต้องตั้ง HTTPS ก่อน
- ห้ามใส่ข้อมูลผู้ป่วยจริงในเครื่องทดสอบนี้
