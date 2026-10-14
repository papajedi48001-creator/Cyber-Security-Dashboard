# Cyber Security Dashboard — โรงพยาบาลวาริชภูมิ

ระบบเฝ้าระวังและจัดการเหตุการณ์ความมั่นคงปลอดภัยไซเบอร์ของโรงพยาบาลวาริชภูมิ ประกอบด้วย

- **Wazuh all-in-one** ติดตั้งบน VM ใหม่แยกจาก FortiSIEM (FortiSIEM ทำงานต่อตามเดิม) ใช้รับ Log, ตรวจจับ และสืบค้นเชิงลึก
- **TLS Log Relay** รับ Syslog จาก Sophos Firewall แบบเข้ารหัสและ buffer ระหว่าง Wazuh หยุดทำงาน
- **Security Operations Portal** สำหรับงานประจำวันของทีม IT: Incident, audit, asset, backup evidence, port monitor, Cloudflare, Duo และรายงานผู้บริหาร

ระบบไม่เก็บข้อมูลผู้ป่วย ไม่ทำสำเนา raw log ใน Portal และเปิดใช้ได้เฉพาะจาก Management VLAN หรือ VPN ที่มี MFA

## สถานะ

ยังอยู่ในขั้นออกแบบ มีเฉพาะเอกสาร ยังไม่มีโค้ดหรือ infrastructure

## เอกสาร

| เอกสาร | เนื้อหา |
|---|---|
| [CONTEXT.md](CONTEXT.md) | คำศัพท์กลางของโครงการ ใช้คำตามนี้ในเอกสาร หน้าจอ และโค้ด |
| [Design spec](docs/superpowers/specs/2026-10-08-waritchaphum-cyber-security-dashboard-design.md) | สถาปัตยกรรม, data policy, workflow, SLA, ขั้นตอนย้ายระบบ |
| [docs/adr/](docs/adr/) | บันทึกการตัดสินใจทางสถาปัตยกรรม |
| [Delivery roadmap](docs/superpowers/plans/2026-10-08-security-operations-delivery-roadmap.md) | ลำดับแผนงานและเงื่อนไขผ่านแต่ละขั้น |
| [Portal Integration UAT](docs/operations/portal-integration-uat.md) | ผลทดสอบการเชื่อมต่อ Portal และรายการ UAT ร่วมกับโรงพยาบาล |
| [Notification runbook](docs/operations/notification-runbook.md) | ตั้งค่าและรับมือการแจ้งเตือน Email / LINE OA ที่ส่งไม่สำเร็จ |
| [Backup Evidence runbook](docs/operations/backup-evidence-runbook.md) | บันทึกผล backup และผลทดสอบกู้คืน |
| [Duo Manual Check runbook](docs/operations/duo-manual-check-runbook.md) | ขั้นตอนตรวจ Duo ด้วยมือรายวัน |

## โครงสร้างที่วางแผนไว้

```text
docs/            เอกสารออกแบบ, ADR, แผนงาน, runbook (docs/operations/)
infrastructure/  template ของ Log Relay, Wazuh และ external scan (เฉพาะไฟล์ *.example)
portal/          Security Operations Portal (Next.js + TypeScript + Prisma + MariaDB)
```

## การรัน Portal

Portal มี 2 process ที่ใช้ฐานข้อมูลเดียวกัน (ตั้งค่าตาม `portal/.env.example`)

```bash
cd portal
npm ci && npx prisma migrate deploy
npm run build && npm start   # หน้าเว็บ
npm run worker               # ดึง alert จาก Wazuh, เปิด incident, ตรวจแหล่ง Log ขาดหาย, พอร์ต, Cloudflare WAF (ถ้าตั้งค่า), ส่งแจ้งเตือน
```

แจ้งเตือนส่งทาง Email (SMTP) และ/หรือ LINE OA โดยมีเฉพาะระดับ, เลข incident, เวลาที่ตรวจพบ, ชื่อระบบ และลิงก์ Portal
P1/P2 ส่งทันทีตลอด 24 ชม. P3/P4 ส่งในเวลาทำการ การส่งที่ล้มเหลวจะลองใหม่และแสดงในหน้า Incident

## การมีส่วนร่วม

- ทำงานผ่าน branch และ Pull Request ไม่ commit ตรงเข้า `master`
- ห้าม commit credential, certificate, private key, IP จริง หรือ inventory จริง ให้ commit เฉพาะไฟล์ `*.example`
- การตัดสินใจที่เปลี่ยนสถาปัตยกรรมให้เขียน ADR ใหม่ใน `docs/adr/` และแก้ ADR เดิมให้ระบุว่าถูกแทนที่
