# Log Archive Runbook

Hot Log ค้นหาได้ใน Wazuh 90 วัน หลังจากนั้นเก็บเป็น Log Archive แบบเข้ารหัสอีกจนครบ 1 ปี (spec: Data policy and retention) ใช้ ISM policy จาก `infrastructure/wazuh/index-lifecycle-policy.example.json`

## ตั้งค่าครั้งแรก

1. **เตรียม snapshot repository** ชื่อ `gdcc-archive` ที่ชี้ไปยังพื้นที่จัดเก็บของ GDCC ที่เข้ารหัส:
   - ถ้า GDCC ให้ object storage แบบ S3: ใช้ repository type `s3` พร้อม server-side encryption และเก็บ access key ใน indexer keystore (`opensearch-keystore add`) ไม่ใส่ในไฟล์ config
   - ถ้าเป็น NFS/SMB: mount บน `path.repo` ที่อยู่บน volume เข้ารหัส (LUKS) แล้วลงทะเบียนเป็น type `fs`
   ```bash
   curl -sk -u <admin> -X PUT https://localhost:9200/_snapshot/gdcc-archive \
     -H 'Content-Type: application/json' -d '{"type":"fs","settings":{"location":"/mnt/gdcc-archive"}}'
   ```
2. **ติดตั้ง ISM policy**:
   ```bash
   curl -sk -u <admin> -X PUT https://localhost:9200/_plugins/_ism/policies/wazuh-retention \
     -H 'Content-Type: application/json' -d @infrastructure/wazuh/index-lifecycle-policy.example.json
   ```
   ตรวจว่า index ที่มีอยู่แล้วได้ policy: `GET _plugins/_ism/explain/wazuh-alerts-*`
3. **ตั้งการลบ snapshot เมื่อครบ 1 ปี** ด้วย snapshot management หรือ cron ที่ลบ snapshot ซึ่งอายุเกิน 365 วัน บันทึกทุกการลบใน audit ของทีม

กุญแจเข้ารหัสของ archive ใช้ Dual-Control Key Recovery เหมือน Backup Encryption Key

## นำข้อมูลกลับมาค้นหา

1. หา snapshot ที่ครอบช่วงเวลาที่ต้องการ: `GET _snapshot/gdcc-archive/_all`
2. restore ไปเป็นชื่อใหม่ ไม่ทับ index ที่ใช้งาน:
   ```bash
   curl -sk -u <admin> -X POST https://localhost:9200/_snapshot/gdcc-archive/<snapshot>/_restore \
     -H 'Content-Type: application/json' \
     -d '{"indices":"wazuh-archives-4.x-2026.01.15","rename_pattern":"(.+)","rename_replacement":"restored-$1"}'
   ```
3. ค้นหาใน Wazuh dashboard ผ่าน index pattern `restored-*`
4. ลบ `restored-*` เมื่อสืบค้นเสร็จ และบันทึกว่าใครนำข้อมูลกลับมาเพื่ออะไร

## ทดสอบ

ทุกไตรมาส restore snapshot หนึ่งวันมาค้นหา event ที่รู้ว่ามีอยู่ แล้วบันทึกผลและเวลาที่ใช้
