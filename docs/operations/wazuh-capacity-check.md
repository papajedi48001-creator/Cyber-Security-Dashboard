# Wazuh Capacity Check

ตรวจหลังติดตั้งและทุกเดือน เทียบกับเกณฑ์ใน [siem-capacity-baseline.md](./siem-capacity-baseline.md#เกณฑ์ขยาย-scale-out-threshold)

| ตัวชี้วัด | คำสั่ง | เกณฑ์ |
|---|---|---|
| Event ที่ analysisd ทิ้ง | `grep events_dropped /var/ossec/var/run/wazuh-analysisd.state` | ต้องเป็น 0 |
| คิว event ของ analysisd | `grep -E "queue_usage\|event_queue" /var/ossec/var/run/wazuh-analysisd.state` | < 70% |
| EPS ที่รับ | `grep events_received /var/ossec/var/run/wazuh-analysisd.state` เทียบสองช่วงเวลา | < 70% ของ EPS ที่ทดสอบผ่าน |
| Disk ของ indexer | `curl -sk -u <admin> https://localhost:9200/_cat/allocation?v` | < 75% |
| Heap ของ indexer | `curl -sk -u <admin> https://localhost:9200/_nodes/stats/jvm?pretty` ดู `heap_used_percent` | < 85% |
| ขนาด index ต่อวัน | `curl -sk -u <admin> 'https://localhost:9200/_cat/indices/wazuh-*?v&s=index'` | ตรงกับประมาณการ |
| Relay health | ค่าล่าสุดใน `/var/log/relay-health.json` บน relay | healthy |

ห้ามวางรหัสผ่านในคำสั่งที่บันทึกลง history ให้ใช้ไฟล์ `.netrc` ที่สิทธิ์ 600 หรือพิมพ์เมื่อถูกถาม

## บันทึกผล

| วันที่ | events_dropped | EPS เฉลี่ย | Disk % | Heap % | ผู้ตรวจ | หมายเหตุ |
|---|---|---|---|---|---|---|
| | | | | | | |
