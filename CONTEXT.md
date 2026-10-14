# Waritchaphum Hospital Cyber Security Operations

คำศัพท์กลางสำหรับระบบเฝ้าระวังและติดตามเหตุการณ์ความมั่นคงปลอดภัยไซเบอร์ของโรงพยาบาลวาริชภูมิ เพื่อให้หน้าจอ กฎตรวจจับ และกระบวนการปฏิบัติงานใช้ความหมายเดียวกัน

## Language

**Security Event**:
เหตุการณ์หรือความผิดปกติที่ระบบตรวจพบและนำเสนอให้ทีม IT พิจารณา แต่ยังไม่จำเป็นต้องเป็นเหตุการณ์ที่ต้องดำเนินการทุกครั้ง
_Avoid_: Incident, Ticket

**Security Incident**:
Security Event ที่ผ่านการพิจารณาแล้วว่าต้องมีผู้รับผิดชอบและติดตามตั้งแต่รับทราบ กำลังแก้ไข จนถึงปิดพร้อมหลักฐาน
_Avoid_: Alert, Log

**External Port Exposure**:
บริการหรือพอร์ตของระบบภายในโรงพยาบาลที่สามารถเข้าถึงได้จาก Internet และต้องประเมินว่าได้รับอนุญาตหรือมีความเสี่ยง
_Avoid_: Blacklist Port, Scan Port

**Restricted Egress Violation**:
การเชื่อมต่อจากระบบภายในโรงพยาบาลไปยังพอร์ตหรือปลายทางภายนอกที่นโยบายกำหนดให้ต้องห้ามหรือจำกัด
_Avoid_: External Port Exposure, Outbound Attack

**Log Source Health**:
สถานะที่บอกว่าแหล่งข้อมูลความมั่นคงปลอดภัยยังส่งข้อมูลได้ต่อเนื่องและทันเวลาตามเกณฑ์ที่กำหนด
_Avoid_: ระบบปลอดภัย, ไม่มีเหตุการณ์

**Critical Asset**:
ระบบที่การหยุดชะงักหรือถูกโจมตีอาจกระทบการให้บริการหลักของโรงพยาบาล และเป็นขอบเขตเฝ้าระวังลำดับแรก
_Avoid_: อุปกรณ์ทุกเครื่อง, เครื่องสำคัญ

**Security Administrator**:
ผู้ดูแลการตั้งค่า แหล่งข้อมูล ผู้ใช้งาน และนโยบายของ Portal โดยต้องใช้การยืนยันตัวตนหลายปัจจัย
_Avoid_: Security Operator, ผู้บริหาร

**Security Operator**:
เจ้าหน้าที่ IT ที่ตรวจสอบ รับผิดชอบ และบันทึกการดำเนินการต่อ Security Incident โดยต้องใช้การยืนยันตัวตนหลายปัจจัย
_Avoid_: Security Administrator, ผู้ชม

**Executive Viewer**:
ผู้ใช้แบบอ่านอย่างเดียวที่เห็นสถานะ ความเสี่ยง และผลการดำเนินงานในระดับสรุป โดยไม่แก้ไขการตั้งค่าหรือเหตุการณ์
_Avoid_: Security Operator

**Hot Log**:
Log ที่ยังค้นหาและวิเคราะห์ใน Wazuh ได้โดยตรงภายในช่วงเวลาเก็บข้อมูลออนไลน์ที่กำหนด
_Avoid_: Log Archive

**Log Archive**:
Log แบบเข้ารหัสที่เก็บระยะยาวและต้องผ่านกระบวนการนำกลับก่อนการค้นหาหรือวิเคราะห์
_Avoid_: Hot Log, Backup File

**Backup Evidence**:
ข้อมูลยืนยันผลการสำรองและทดสอบกู้คืน เช่น เวลาสำเร็จล่าสุด อายุข้อมูล ขนาด ปลายทาง และผลการทดสอบ โดยไม่มีสิทธิ์สั่งงานสำรองหรือกู้คืน
_Avoid_: Backup File, Backup Job

**Backup File Management**:
ขีดความสามารถในอนาคตสำหรับควบคุมวงจรชีวิตของไฟล์สำรองภายใต้สิทธิ์และการอนุมัติที่แยกจากการเฝ้าระวัง
_Avoid_: Backup Evidence, การลบไฟล์โดยตรง

**Backup Lifecycle Request**:
คำขอจัดการไฟล์สำรองในอนาคต เช่น ย้ายเข้าคลัง เก็บต่อ หรือทำลาย ซึ่งต้องมีผู้เสนอ ผู้อนุมัติ สถานะ และหลักฐานการดำเนินการ
_Avoid_: คำสั่งลบไฟล์โดยตรง

**Backup Deletion Hold**:
ช่วงพักรอหลังคำขอลบ Backup File ผ่านการอนุมัติ แต่ก่อนการทำลายข้อมูลจริง เพื่อเปิดโอกาสให้ยกเลิกเมื่อพบความผิดพลาด
_Avoid_: Soft Delete, ลบแล้วทันที

**Backup Encryption Key**:
กุญแจเข้ารหัสของ Backup File ที่ต้องเก็บและควบคุมแยกจากพื้นที่จัดเก็บไฟล์สำรอง
_Avoid_: รหัสผ่าน GDCC, Backup File

**Backup Job Success**:
สถานะที่ยืนยันว่างานสำรองข้อมูลเสร็จตามรายงานของระบบสำรอง แต่ไม่ยืนยันว่าไฟล์สามารถกู้คืนและใช้งานได้
_Avoid_: Backup Verified, กู้คืนได้

**Dual-Control Key Recovery**:
การเข้าถึงหรือกู้คืน Backup Encryption Key ที่ต้องอาศัยการอนุมัติหรือการมีส่วนร่วมจากผู้รับผิดชอบอย่างน้อยสองคน
_Avoid_: ผู้ถือกุญแจคนเดียว

**Closure Evidence**:
หลักฐานที่ผูกกับ Security Incident เพื่อยืนยันว่าการแก้ไขมีผล เช่น Log หลังแก้ไข ผลตรวจซ้ำ หรือภาพการตั้งค่าที่อนุมัติให้เก็บ
_Avoid_: หมายเหตุปิดงาน

**Incident Reviewer**:
ผู้ทบทวนที่แยกจากผู้ดำเนินการและยืนยัน Closure Evidence ก่อนปิด Security Incident ระดับ P1 หรือ P2
_Avoid_: ผู้ปิดเหตุการณ์

**Notification Summary**:
ข้อมูลขั้นต่ำสำหรับแจ้งเหตุผ่าน LINE OA ได้แก่ ระดับความรุนแรง เลข Incident เวลาตรวจพบ ชื่อระบบ และลิงก์เข้าสู่ Portal
_Avoid_: Log ดิบ, IP ภายใน, Username, รายละเอียดผู้ป่วย

**Sophos Priority Signal**:
สัญญาณจาก Sophos Firewall ที่มีนัยต่อความมั่นคงปลอดภัยและอยู่ในขอบเขตตรวจจับรุ่นแรก ได้แก่ การบล็อก การเข้าถึงผิดพลาดหรือผู้ดูแลระบบ เปลี่ยน Firewall Rule, VPN ผิดปกติ, IPS/AV/Web protection และ Log Source Health
_Avoid_: Sophos Log ทุกชนิด

**Sampled WAF Event**:
เหตุการณ์จาก Cloudflare Free WAF ที่ใช้เพื่อดูแนวโน้มและคัดแยกความผิดปกติ แต่ไม่ใช่บันทึกคำขอเว็บครบทุกครั้ง
_Avoid_: Raw WAF Log, หลักฐานการสืบสวนครบถ้วน

**Duo Manual Check**:
การตรวจสอบสถานะและ Log ของ Duo ผ่าน Duo Admin Panel โดยเจ้าหน้าที่ในช่วงที่ Portal ยังไม่มีสิทธิ์เชื่อมต่อ Duo Admin API แบบอ่านอย่างเดียว
_Avoid_: Duo Connector, การนำเข้าข้อมูลอัตโนมัติ

**EDR Adapter**:
ส่วนเชื่อมต่อผู้ให้บริการ EDR ที่แปลงข้อมูลสถานะเครื่อง การตรวจพบภัยคุกคาม ระดับความรุนแรง การแยกเครื่อง และสุขภาพของ Agent เป็นรูปแบบกลางของ Portal
_Avoid_: EDR ผู้ให้บริการเฉพาะราย, EDR Module แบบผูกค่าย

**Operational Security Data**:
ข้อมูลเทคนิคที่จำเป็นต่อการตรวจสอบความมั่นคงปลอดภัย เช่น เวลา แหล่งกำเนิด ปลายทาง กฎและผลการตรวจจับ โดยลดหรือปกปิดข้อมูลส่วนบุคคลและไม่รับข้อมูลผู้ป่วย
_Avoid_: ข้อมูลผู้ป่วย, ข้อมูลส่วนบุคคลที่ไม่จำเป็น

**Existing SIEM**:
FortiSIEM ที่ INET ให้บริการอยู่ก่อนโครงการนี้ บน Existing SIEM Server โครงการนี้ไม่หยุด ไม่แก้ไข และไม่ติดตั้งทับ (ADR 0008) อนาคตของ FortiSIEM เป็นการตัดสินใจแยกของโรงพยาบาล
_Avoid_: SIEM ใหม่, ระบบที่โรงพยาบาลจะดูแลต่อระยะยาว

**Existing SIEM Server**:
เครื่อง server เดิมที่ใช้รัน FortiSIEM ซึ่งยังทำงานต่อตามเดิม Wazuh ไม่ได้ติดตั้งบนเครื่องนี้ (ADR 0008)
_Avoid_: เครื่องที่จะติดตั้ง Wazuh

**Wazuh VM**:
VM ใหม่ที่สร้างเพื่อรัน Wazuh All-in-One โดยเฉพาะ แยกจาก FortiSIEM, TLS Log Relay และ Portal
_Avoid_: Existing SIEM Server, เครื่องที่ใช้ร่วมกับระบบอื่น

**SIEM Service Transition**:
การส่งมอบความรับผิดชอบ FortiSIEM จาก INET สู่โรงพยาบาล โดยรักษาความต่อเนื่องของข้อมูล การตรวจจับ และสิทธิ์เข้าถึงที่จำเป็น
_Avoid_: การยกเลิกบริการโดยไม่ส่งมอบ, การเปลี่ยน SIEM โดยทันที

**SIEM Handover Package**:
ชุดสิ่งส่งมอบก่อนยุติบริการ SIEM ได้แก่ credential, แผนผัง, inventory, สเปก, log source, rule/parser/report, runbook, คู่มืออัปเกรด และหลักฐานการทดสอบรับมอบ
_Avoid_: credential อย่างเดียว, เอกสารเท่าที่มี

**Shared SIEM Operations**:
รูปแบบที่ทีม IT โรงพยาบาลร่วมกันรับผิดชอบ Wazuh โดยไม่มี SIEM Owner รายบุคคล แต่ทุกการเข้าถึงและเปลี่ยนแปลงต้องยังตรวจสอบย้อนหลังได้
_Avoid_: ผู้รับผิดชอบ SIEM คนเดียว

**Emergency SIEM Change**:
การปรับ Rule, Decoder หรือการตั้งค่า Wazuh ได้ทันทีเมื่อจำเป็น โดยต้องบันทึกเหตุผล ผู้ดำเนินการ เวลา และผลกระทบหลังดำเนินการ
_Avoid_: การเปลี่ยนแปลงที่ไม่มีร่องรอย

**SIEM Handover Acceptance Test**:
การทดสอบรับมอบที่รวมการเข้าใช้ระบบ การรับ Sophos Log, Rule ตรวจจับตัวอย่าง, การ export หลักฐาน และ backup/restore FortiSIEM พร้อมบันทึกผลร่วมกัน เพื่อให้โรงพยาบาลดูแล FortiSIEM ต่อได้หลังบริการ INET สิ้นสุด
_Avoid_: การรับมอบด้วยเอกสารอย่างเดียว

**Open Source SIEM**:
แพลตฟอร์ม SIEM ที่โรงพยาบาลติดตั้งและควบคุมเองบน Wazuh VM ในโครงการนี้คือ Wazuh โดยไม่ผูกกับสิทธิ์ใช้งานหรือบริการ INET
_Avoid_: FortiSIEM ที่ไม่มีสิทธิ์ใช้งาน, SIEM แบบ managed service

**Legacy SIEM Evidence Store**:
ชุดข้อมูลที่ export จาก FortiSIEM (รายงาน, rule, parser, การตั้งค่า, Log ในช่วง retention) และ image สำรองของ FortiSIEM ที่เก็บแบบเข้ารหัสนอก Existing SIEM Server จนสิ้นสุดระยะเวลา retention ใช้เฉพาะเมื่อโรงพยาบาลตัดสินใจปลด FortiSIEM ในภายหลัง ไม่ใช่เงื่อนไขก่อนติดตั้ง Wazuh
_Avoid_: การย้าย Log ดิบทั้งหมดเข้า Wazuh, การล้างเครื่องโดยไม่ export

**Emergency Rule Change Evidence**:
หลักฐานของการปรับ Rule แบบทันที ได้แก่ ผู้ดำเนินการ เวลา เหตุผล ค่า Rule ก่อนและหลังเปลี่ยน และผลตรวจสอบหลังเปลี่ยน
_Avoid_: บันทึกแค่ชื่อและเวลา, การปรับ Rule ที่ไร้ร่องรอย

**Wazuh All-in-One**:
การติดตั้ง Wazuh server, indexer และ dashboard บน Wazuh VM เครื่องเดียวสำหรับขอบเขตรุ่นแรก โดยต้องติดตาม capacity เพื่อเตรียมแยก node เมื่อข้อมูลหรือจำนวนแหล่ง Log เพิ่มขึ้น
_Avoid_: Wazuh cluster ตั้งแต่เริ่ม, การขยายโดยไม่มีหลักฐาน capacity

**TLS Log Relay**:
ระบบรับ Syslog จาก Sophos Firewall แบบ TLS ภายในเครือข่ายโรงพยาบาล ที่ตรวจสอบแหล่งส่ง เก็บ buffer ชั่วคราว และส่งต่อ Log ไปยัง Wazuh โดยรันแยกจากเครื่อง Wazuh เพื่อ buffer ได้ระหว่าง Wazuh หยุดทำงาน
_Avoid_: Log Collector, Syslog แบบไม่เข้ารหัส, การส่ง Sophos Log เข้า Wazuh โดยตรง, Log Relay บน Internet

**SIEM Recovery Objective**:
เป้าหมายกู้คืน Wazuh all-in-one และข้อมูลที่จำเป็นภายใน 24 ชั่วโมง โดยยอมรับช่องว่าง Log ที่อาจเกิดขึ้นระหว่างการกู้คืน
_Avoid_: High Availability, ไม่มี downtime

**Security Operations Portal**:
ศูนย์เฝ้าระวังประจำวันของทีม IT โรงพยาบาลสำหรับการจัดการ Security Incident, Backup Evidence, Cloudflare, Duo, Port Monitor และรายงานสรุปสำหรับผู้บริหาร โดยดึงสรุป alert จาก Wazuh Indexer แบบอ่านอย่างเดียว (ADR 0006)
_Avoid_: Security Operations Dashboard (ชื่อเดิม), Wazuh Dashboard, หน้าจอ SIEM, SOC เต็มรูปแบบ

**Forensic Investigation**:
การสืบค้นและวิเคราะห์ Log เชิงลึกใน Wazuh เพื่อหาข้อเท็จจริงของเหตุการณ์
_Avoid_: การทำงาน Incident ประจำวัน, Executive Summary

**Portal Application Server**:
VM หรือ Server ภายในที่แยกจาก Wazuh ซึ่งให้บริการ Security Operations Portal และฐานข้อมูลเฉพาะของ Portal
_Avoid_: Wazuh all-in-one host, HOSxP server

**Portal Security Database**:
ฐานข้อมูลเฉพาะของ Security Operations Portal สำหรับ Incident, audit log, asset register และ Backup Evidence ซึ่งแยกจากฐานข้อมูล HIS (HOSxP)
_Avoid_: HOSxP database, Wazuh Indexer

**Management-Only Access**:
การเข้าถึง Security Operations Portal จาก Management VLAN หรือผ่าน VPN ที่บังคับ MFA เท่านั้น
_Avoid_: Internet สาธารณะ, การเปิดใช้ทุก VLAN

**Portal MariaDB**:
MariaDB instance หรือ service ที่จัดสรรเฉพาะ Security Operations Portal และแยกจากฐานข้อมูล HOSxP
_Avoid_: ฐานข้อมูล HOSxP ร่วม, Wazuh Indexer

**Portal Identity Transition**:
การใช้ Local Account พร้อม MFA สำหรับ Security Administrator และ Security Operator ในระยะแรก แล้วเปลี่ยนการยืนยันตัวตนของ Portal ไปใช้ AD/LDAP เมื่อระบบเสถียร
_Avoid_: Local Account ถาวร, บัญชีร่วม, การเปิดใช้โดยไม่มี MFA

**Wazuh Service Account**:
บัญชีเฉพาะของ Portal ที่มีสิทธิ์อ่าน alert index ใน Wazuh Indexer เท่านั้น หมุนเวียน credential ได้ และบันทึกการใช้งานได้
_Avoid_: บัญชีส่วนบุคคล, บัญชี admin ของ Wazuh

**External Exposure Scan**:
การสแกนพอร์ตของ public IP ของโรงพยาบาลจากภายนอกเครือข่ายตามรอบที่อนุมัติ เพื่อหา External Port Exposure (ADR 0007)
_Avoid_: การสแกนเครือข่ายภายใน, การสแกน IP ที่ไม่ใช่ของโรงพยาบาล

**Approved Exposure**:
รายการพอร์ตหรือบริการที่อนุญาตให้เข้าถึงจาก Internet โดยมีผู้รับผิดชอบ เหตุผล และวันหมดอายุ เมื่อหมดอายุต้องกลับมาทบทวน
_Avoid_: Allowlist ถาวร

## Deprecated terms

คำเหล่านี้มาจากแนวทางเดิมที่ให้โรงพยาบาลดูแล FortiSIEM ต่อ (ADR 0001 ซึ่งถูกแทนที่แล้ว) ไม่ควรใช้ในเอกสารหรือโค้ดใหม่

| คำเดิม | ใช้คำนี้แทน |
|---|---|
| Security Operations Dashboard | Security Operations Portal |
| FortiSIEM Integration | การดึงข้อมูลจาก Wazuh Indexer (ADR 0006) |
| SIEM Service Account | Wazuh Service Account |
| SIEM Self-Operation | Shared SIEM Operations บน Wazuh |
| TLS Syslog Ingestion, Log Collector | TLS Log Relay |
| Transitional Dashboard Identity | Portal Identity Transition |
