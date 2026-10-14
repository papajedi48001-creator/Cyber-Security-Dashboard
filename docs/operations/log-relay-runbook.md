# TLS Log Relay Runbook

Relay รับ Syslog จาก Sophos Firewall แบบ TLS (port 6514) ตรวจใบรับรองและ IP ผู้ส่ง เก็บ buffer บนดิสก์ แล้วส่งต่อให้ Wazuh (wazuh-remoted, TCP 514) ไฟล์ทั้งหมดอยู่ใน `infrastructure/log-relay/`

| ไฟล์ | หน้าที่ |
|---|---|
| `syslog-ng.conf.template` | template ของ config |
| `allowed-sources.example` | ตัวอย่าง allowlist ของผู้ส่ง (ของจริงชื่อ `allowed-sources` และไม่ commit) |
| `render_config.py` | สร้าง config จริงจาก template และ allowlist พร้อมตรวจความถูกต้อง |
| `relay_health.py` | อ่าน `syslog-ng-ctl stats` แล้วรายงาน healthy/degraded/failed/unknown |
| `tests/` | unit test และ end-to-end test ด้วย syslog-ng จริงกับ TLS จำลอง |

## ข้อกำหนดเครื่อง

- VM แยกจาก Wazuh VM (ADR 0004, ADR 0008) อยู่ใน Management VLAN
- syslog-ng 4.x, Python 3.10 ขึ้นไป, openssl
- พื้นที่ดิสก์สำหรับ buffer ≥ EPS สูงสุด × ขนาด event เฉลี่ย × ระยะเวลาที่ Wazuh อาจหยุด (อย่างน้อย 24 ชั่วโมงตาม SIEM Recovery Objective) ให้คำนวณจาก [siem-capacity-baseline.md](./siem-capacity-baseline.md)
- Firewall ของ relay: รับ 6514/tcp เฉพาะจาก Sophos และส่งออก 514/tcp เฉพาะไป Wazuh

## ติดตั้งครั้งแรก

1. ติดตั้งแพ็กเกจ `syslog-ng-core` และ `python3`
2. วางใบรับรองใน `/etc/syslog-ng/tls/`: `relay.key` (สิทธิ์ 600), `relay.crt` และ CA ของโรงพยาบาลใน `ca.d/` แล้วรัน `openssl rehash /etc/syslog-ng/tls/ca.d`
3. สร้าง `allowed-sources` จาก `allowed-sources.example` ใส่ IP ของ Sophos ที่ส่ง log (ห้าม wildcard หรือ network กว้างกว่า /24 ซึ่งตัว render จะปฏิเสธ)
4. สร้าง config:
   ```bash
   python3 render_config.py --allowed-sources allowed-sources \
     --listen-ip <IP relay> --wazuh-host <IP Wazuh> --buffer-size-mb <ขนาด> \
     > /etc/syslog-ng/syslog-ng.conf
   syslog-ng --syntax-only -f /etc/syslog-ng/syslog-ng.conf
   systemctl restart syslog-ng
   ```
5. ฝั่ง Wazuh ใน `ossec.conf` เพิ่ม `<remote>` ชนิด syslog, protocol tcp, port 514 และ `<allowed-ips>` เป็น IP ของ relay เท่านั้น
6. ฝั่ง Sophos ตั้ง Syslog server เป็น IP relay port 6514 เปิด secure log transmission (TLS) และติดตั้งใบรับรอง client ที่ออกโดย CA ของโรงพยาบาล การเปลี่ยนนี้เป็น production change ต้องได้รับอนุมัติก่อน

ข้อจำกัด: wazuh-remoted รับ syslog แบบ TLS ไม่ได้ ช่วง relay ไป Wazuh จึงเป็น TCP ภายใน Management VLAN และจำกัดด้วย allowed-ips ถ้าต้องการเข้ารหัสช่วงนี้ ให้ติดตั้ง Wazuh agent บน relay แล้วให้ syslog-ng เขียนลงไฟล์แทน

## ตรวจสุขภาพ

```bash
syslog-ng-ctl stats | python3 relay_health.py --stats-file - --queued-warn 1000
```

| สถานะ | exit code | ความหมาย | สิ่งที่ต้องทำ |
|---|---|---|---|
| healthy | 0 | ส่งต่อปกติ | - |
| degraded | 1 | มี event ค้างใน buffer เกินเกณฑ์ | ตรวจว่า Wazuh รับได้หรือไม่ (`systemctl status wazuh-manager`, network) |
| failed | 2 | มี event ถูกทิ้ง | ถือเป็นเหตุการณ์ Log Source Health เปิด Incident และบันทึกช่วงเวลาที่หาย |
| unknown | 3 | หา destination ใน stats ไม่เจอ | ตรวจว่า syslog-ng ทำงานและ config ถูกต้อง |

ตั้ง cron หรือ systemd timer ให้รันทุก 1 นาที และส่งผลเข้า monitoring ของทีม

## งานประจำ

### หมุนใบรับรอง

1. ออกใบรับรองใหม่จาก CA ของโรงพยาบาลก่อนหมดอายุอย่างน้อย 30 วัน
2. วางไฟล์ใหม่ ตรวจด้วย `syslog-ng --syntax-only` แล้ว `systemctl reload syslog-ng`
3. ส่ง log ทดสอบจาก Sophos และตรวจว่าเข้า Wazuh
4. ถ้าเปลี่ยน CA ให้ติดตั้ง CA ใหม่ใน `ca.d/` คู่กับของเดิมก่อน แล้วค่อยถอดของเดิมเมื่อ Sophos ใช้ใบใหม่แล้ว

### เปลี่ยน allowlist

แก้ `allowed-sources` แล้วรันขั้นตอนที่ 4 ของการติดตั้งใหม่ ตรวจ `rejected-senders.log` ว่าไม่มี IP ที่ควรได้รับอนุญาตถูกปฏิเสธ บันทึกการเปลี่ยนแปลงใน audit ของทีม

### ตรวจ buffer

- ขนาดปัจจุบัน: `du -sh /var/lib/syslog-ng/buffer`
- จำนวนค้าง: ค่า `queued` ใน `syslog-ng-ctl stats`
- ถ้า buffer ใกล้เต็ม syslog-ng จะหยุดอ่านจาก Sophos (flow-control) และ Sophos จะเริ่มเก็บ/ทิ้ง log ฝั่งตัวเอง ให้แก้ปัญหาฝั่ง Wazuh ก่อน

### Restart

`systemctl restart syslog-ng` buffer บนดิสก์แบบ reliable จะถูกส่งต่อหลัง restart ตรวจสุขภาพหลัง restart ทุกครั้ง

## Rollback

Sophos ส่ง log ไป FortiSIEM ตามปลายทางเดิมตลอด (ADR 0008) relay เป็นปลายทางที่สองเท่านั้น จึง rollback ได้โดย:

- ลบหรือปิดปลายทาง Syslog ที่ชี้มาที่ relay ใน Sophos (ต้องได้รับอนุมัติเหมือนตอนเพิ่ม)
- ห้ามแก้ปลายทางเดิมที่ส่งไป FortiSIEM ค่าเดิมบันทึกไว้ใน [fortisiem-handover-checklist.md](./fortisiem-handover-checklist.md)

ทุกครั้งที่ rollback ให้บันทึกเวลาเริ่ม-จบ และช่วงที่ Wazuh ไม่ได้รับ log

## ทดสอบ

```bash
python3 -m unittest discover -s infrastructure/log-relay/tests -v
```

End-to-end test ใช้ syslog-ng จริง สร้าง CA และใบรับรองชั่วคราว แล้วตรวจว่า: ผู้ส่งที่อนุญาตส่งถึง Wazuh จำลอง, ใบรับรองไม่น่าเชื่อถือถูกปฏิเสธ, IP ที่ไม่อยู่ใน allowlist ถูกบันทึกใน `rejected-senders.log` โดยไม่เก็บเนื้อหา, และเมื่อ Wazuh หยุด event จะค้างใน buffer (health = degraded) แล้วส่งครบเมื่อ Wazuh กลับมา
