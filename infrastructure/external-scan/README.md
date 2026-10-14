# External Exposure Scan

ตรวจว่าพอร์ตใดของ public address โรงพยาบาลเปิดถึงได้จริงจาก Internet (ADR 0007) แล้วส่งผลแบบสรุปเข้า Portal หน้า "พอร์ต"

## ขอบเขตและการอนุมัติ

- สแกนเฉพาะ public address ที่โรงพยาบาลเป็นเจ้าของ ตามรายการใน `targets.txt` ที่ผู้บริหารอนุมัติเป็นลายลักษณ์อักษร
- แจ้ง ISP และผู้ให้บริการ hosting ที่เกี่ยวข้องก่อนเริ่มสแกนตามรอบ
- เครื่องสแกนต้องอยู่นอกเครือข่ายโรงพยาบาล (เช่น VPS) ไม่มี credential ใด ๆ ของโรงพยาบาล และไม่เชื่อมต่อเข้า Portal โดยตรง
- `nmap_to_summary.py` ปฏิเสธผลที่มี host นอกรายการอนุมัติ และไม่ส่ง banner, ผล script, OS หรือ hostname ออกจากเครื่องสแกน

## ติดตั้งบนเครื่องสแกน

```bash
sudo apt-get install -y nmap python3
sudo mkdir -p /opt/external-scan/reports /opt/external-scan/summaries
sudo cp nmap_to_summary.py /opt/external-scan/
sudo cp targets.example /opt/external-scan/targets.txt     # แก้เป็น address จริงที่อนุมัติ
sudo cp run-scan.sh.example /opt/external-scan/run-scan.sh && sudo chmod 750 /opt/external-scan/run-scan.sh
echo '30 1 * * * root /opt/external-scan/run-scan.sh' | sudo tee /etc/cron.d/external-scan
```

สแกนวันละครั้ง Portal ถือว่าผลเกิน 36 ชั่วโมงเป็นข้อมูลไม่เป็นปัจจุบัน (stale) และไม่แสดงว่า "ไม่มีพอร์ตเปิด"

## ส่งผลเข้า Portal

Portal ไม่เปิดรับการเชื่อมต่อจาก Internet ผลสแกนจึงต้องถูกดึงเข้ามาจากฝั่งโรงพยาบาล:

1. เจ้าหน้าที่ IT ดึงไฟล์สรุปล่าสุดจากเครื่องสแกนผ่าน SSH (`scp scanner:/opt/external-scan/summaries/scan-*.json .`)
2. เปิด Portal หน้า "พอร์ต" แล้วนำเข้าไฟล์ในส่วน "นำเข้าผลสแกนจากภายนอก"
3. นำเข้า rule ที่เปิดบริการสู่ภายนอกจาก Sophos (WebAdmin > Rules and policies > NAT rules) ในรูป CSV `rule_name,public_address,port,protocol` เมื่อมีการเปลี่ยน rule

Portal เทียบผลสแกนและ rule กับข้อยกเว้นที่อนุมัติ (มีผู้รับผิดชอบและวันหมดอายุไม่เกิน 180 วัน) แล้วเปิด incident ให้พอร์ตที่ไม่ได้รับอนุมัติ: SSH, RDP, SMB, ฐานข้อมูล และ remote admin เป็น P2 พอร์ตอื่นเป็น P3 rule ที่สแกนไม่พบเป็น P4 ให้ทบทวน

## รูปแบบไฟล์สรุป

```json
{
  "format": "external-exposure-scan/v1",
  "scanner": "nmap 7.95",
  "startedAt": "2026-10-14T01:30:00Z",
  "finishedAt": "2026-10-14T02:00:00Z",
  "targets": ["203.0.113.10"],
  "findings": [{ "address": "203.0.113.10", "port": 443, "protocol": "TCP", "service": "https" }]
}
```

## ทดสอบ

```bash
python3 -m unittest discover -s infrastructure/external-scan/tests
```
