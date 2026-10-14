# Wazuh All-in-One Runbook

ติดตั้ง Wazuh server, indexer และ dashboard บน Wazuh VM ที่สร้างใหม่ (ADR 0008) ไฟล์ config อยู่ใน `infrastructure/wazuh/` ห้ามแตะเครื่อง FortiSIEM

## เงื่อนไขก่อนเริ่ม

ห้ามเริ่มจนกว่าจะครบทุกข้อใน [Go/No-Go](./fortisiem-acceptance-record.md#go-no-go) โดยเฉพาะ: capacity ของ Wazuh VM ผ่าน, Log Relay ติดตั้งและผ่าน test แล้ว และมีผู้อนุมัติการสร้าง Wazuh VM

## ขั้นตอน

1. **สร้าง Wazuh VM** ตามขนาดใน [siem-capacity-baseline.md](./siem-capacity-baseline.md) แล้วติดตั้งระบบปฏิบัติการที่ Wazuh รองรับ (ดูรายการ OS ในเอกสารทางการของรุ่นที่จะใช้)
2. **บันทึกชื่อและขนาด VM** ใน `inventory.yml` (ไฟล์จริงไม่ commit)
3. **ติดตั้ง Wazuh all-in-one** ด้วยสคริปต์ติดตั้งทางการ (`wazuh-install.sh -a`) จดรุ่นที่ติดตั้งใน `inventory.yml` เก็บรหัสผ่านที่สคริปต์สร้างเข้า secrets vault ทันที แล้วลบไฟล์ `wazuh-install-files.tar` ออกจากเครื่อง
4. **จำกัดการเข้าถึง**: เปิด dashboard (443) และ indexer API (9200) เฉพาะจาก Management VLAN/VPN และ Portal Application Server, เปิด 514/tcp เฉพาะจาก relay
5. **ติดตั้ง ruleset**:
   ```bash
   cp infrastructure/wazuh/decoders/*.xml /var/ossec/etc/decoders/
   cp infrastructure/wazuh/rules/*.xml /var/ossec/etc/rules/
   chown wazuh:wazuh /var/ossec/etc/decoders/*.xml /var/ossec/etc/rules/*.xml
   ```
   รวม fragment จาก `ossec.remote.example.xml` เข้า `/var/ossec/etc/ossec.conf` แก้ IP ให้ตรงจริง แล้ว `systemctl restart wazuh-manager`
6. **เปิด archives index**: ใน `/etc/filebeat/filebeat.yml` ตั้ง `archives: enabled: true` แล้ว restart filebeat เพื่อให้ event ทั้งหมด (รวม traffic ที่ไม่เกิด alert) ค้นหาได้ใน `wazuh-archives-*`
7. **ตรวจ ruleset**: `python3 infrastructure/wazuh/logtest_check.py` ต้องผ่านทุกข้อ
8. **ตั้ง index lifecycle**: ดู [log-archive-runbook.md](./log-archive-runbook.md)
9. **สร้าง Wazuh Service Account สำหรับ Portal** (ADR 0006) ใน indexer security:
   - role `portal_alerts_read`: index pattern `wazuh-alerts-*`, สิทธิ์ `read` และ `search` เท่านั้น, ไม่มี cluster permission เกินจำเป็น
   - user `svc-portal` ผูกกับ role นี้ เก็บรหัสผ่านใน vault บันทึกวันหมุนรหัส
   - ทดสอบว่า user นี้อ่าน `wazuh-archives-*` และเขียน index ใด ๆ ไม่ได้
10. **ชี้ relay มาที่ Wazuh** แล้วทดสอบด้วย event จำลอง relay health ต้องเป็น healthy
11. **เพิ่มปลายทาง Syslog ที่สองใน Sophos** ไปที่ relay (ต้องได้รับอนุมัติก่อน) ห้ามแก้หรือลบปลายทางเดิมที่ส่งไป FortiSIEM บันทึกเวลาที่ Wazuh เริ่มได้รับ log ลงใน [sophos-cutover-record.md](./sophos-cutover-record.md)
12. **ตรวจ capacity** ตาม [wazuh-capacity-check.md](./wazuh-capacity-check.md)

## Shared SIEM Operations

- ทุกคนใช้บัญชีของตัวเองใน Wazuh dashboard ห้ามใช้บัญชี `admin` ร่วมกัน (ปิดหรือเก็บรหัสไว้ใน vault สำหรับเหตุฉุกเฉิน)
- ทุกการแก้ rule/decoder ต้องผ่าน pull request ใน repo นี้ ถ้าเป็น Emergency SIEM Change ที่แก้บนเครื่องก่อน ต้องบันทึก Emergency Rule Change Evidence และเปิด PR ตามหลังภายในวันทำการถัดไป

## Rollback

ถ้า Wazuh ไม่ผ่าน acceptance: ลบปลายทาง Syslog ที่สองออกจาก Sophos ตาม [log-relay-runbook.md](./log-relay-runbook.md#rollback) FortiSIEM ยังรับ log ตามเดิม ไม่ต้องกู้คืนอะไร
