# FortiSIEM Handover Checklist

แบบตรวจรับ SIEM Handover Package จาก INET ก่อนติดตั้ง Wazuh แทนที่บน Existing SIEM Server (ADR 0005)
ห้ามบันทึก password, private key หรือข้อมูลผู้ป่วยในเอกสารนี้ ให้อ้างอิงตำแหน่งที่เก็บใน secrets vault แทน

## 1. สิ่งที่ต้องได้รับจาก INET

| # | รายการ | ได้รับแล้ว | ตำแหน่งที่เก็บ (อ้างอิง) | หมายเหตุ |
|---|---|---|---|---|
| H1 | Credential ผู้ดูแลระบบ FortiSIEM (GUI, CLI, OS) ส่งมอบผ่าน vault | ☐ | | |
| H2 | แผนผังเครือข่ายและ data flow ของ SIEM | ☐ | | |
| H3 | Inventory: รุ่นซอฟต์แวร์, license, สเปก VM/server, storage layout | ☐ | | |
| H4 | รายการ log source ทั้งหมดพร้อม protocol/port | ☐ | | |
| H5 | Rule, parser, report และ dashboard ที่ปรับแต่งเอง (export) | ☐ | | |
| H6 | Runbook การ backup และ restore | ☐ | | |
| H7 | คู่มือการ upgrade และ patch ที่ใช้อยู่ | ☐ | | |
| H8 | หลักฐานการทำงานย้อนหลัง (รายงาน incident, ผลทดสอบเดิม) | ☐ | | |
| H9 | ระยะเวลา retention ของ log ที่เก็บอยู่ และพื้นที่ที่ใช้ | ☐ | | |

## 2. การทดสอบรับมอบ (SIEM Handover Acceptance Test)

บันทึกผลจริงใน [fortisiem-acceptance-record.md](./fortisiem-acceptance-record.md) ทุกแถวต้องมีเวลา ผู้ทดสอบ ผลจริง และหลักฐานอ้างอิง รายการที่ยังไม่ได้ทดสอบห้ามทำเครื่องหมายผ่าน

| # | การทดสอบ | เกณฑ์ผ่าน |
|---|---|---|
| A1 | Login ผู้ดูแลระบบด้วยบัญชีที่ส่งมอบ | เข้าได้ทั้ง GUI และ CLI ด้วยบัญชีของโรงพยาบาล |
| A2 | รับ Sophos Log | เห็น event จาก Sophos ภายใน 5 นาทีล่าสุด |
| A3 | การตรวจจับตัวอย่าง | สร้าง event ทดสอบ (เช่น login ผิดบน Sophos) แล้วเกิด incident ใน FortiSIEM |
| A4 | Source health ล้มเหลว | ปิดการส่ง log ชั่วคราวแล้ว FortiSIEM แจ้งว่า source หาย |
| A5 | Export rule/parser/report | ไฟล์ export เปิดอ่านได้และครบตามรายการ H5 |
| A6 | Backup และ restore | ทำตาม runbook H6 แล้วได้ image ที่กู้คืนได้ (ดูขั้น E3 ใน evidence export record) |
| A7 | สิทธิ์อ่านอย่างเดียว | มีบัญชี read-only สำหรับเปิดดูหลักฐานภายหลัง |

## 3. ผลการตัดสินใจ

ดู go/no-go ใน [fortisiem-acceptance-record.md](./fortisiem-acceptance-record.md#go-no-go)
