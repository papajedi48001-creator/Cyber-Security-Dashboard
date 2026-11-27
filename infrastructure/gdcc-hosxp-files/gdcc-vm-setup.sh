#!/usr/bin/env bash
# GDCC VM: one encrypted volume for the HOSxP replica and the HOSxP backup files (ADR 0010).
# Run as root after copying hosxp_offsite.py to /tmp. Replaces the empty 380 GB /srv/replica.img
# with a 440 GB /srv/secure.img and refuses if the old volume holds any non-system database.
#
#   /srv/secure/mysql            MariaDB data, bind-mounted at /var/lib/mysql
#   /srv/secure/hosxp-backups    stored backup ZIPs (root only)
#   /srv/secure/sftp/hosxp/inbox upload chroot of hosxp-upload (SFTP only)
#   /srv/secure/ops              chroot of portal-ops (ADR 0011): status/ read-only, requests/ write
set -euo pipefail
[ -f /tmp/hosxp_offsite.py ] || { echo "ไม่พบ /tmp/hosxp_offsite.py" >&2; exit 1; }
[ -n "${HOSXP_SECURE_SIZE:-}" ] || HOSXP_SECURE_SIZE=440G

dnf -y -q install python3 policycoreutils-python-utils cryptsetup

if [ -e /srv/replica.img ]; then
  if mountpoint -q /var/lib/mysql && ls -d /var/lib/mysql/*/ 2>/dev/null | grep -vqE '/(mysql|performance_schema|sys|test)/$'; then
    echo "ที่เก็บเดิมมีฐานข้อมูลอื่นอยู่ หยุดไว้ก่อน" >&2; exit 1
  fi
  systemctl stop mariadb 2>/dev/null || true
  if mountpoint -q /var/lib/mysql; then umount /var/lib/mysql; fi
  if [ -e /dev/mapper/replica ]; then cryptsetup close replica; fi
  rm -f /srv/replica.img
fi

if ! cryptsetup isLuks /srv/secure.img 2>/dev/null; then
  fallocate -l "$HOSXP_SECURE_SIZE" /srv/secure.img
  chmod 600 /srv/secure.img
  echo ">>> พิมพ์ YES ตัวใหญ่ แล้วตั้งรหัสปลดล็อก 2 ครั้ง"
  cryptsetup luksFormat --type luks2 /srv/secure.img
fi
if [ ! -e /dev/mapper/secure ]; then
  echo ">>> พิมพ์รหัสปลดล็อกอีกครั้ง"
  cryptsetup open /srv/secure.img secure
fi
blkid /dev/mapper/secure >/dev/null 2>&1 || mkfs.xfs -q /dev/mapper/secure
mkdir -p /srv/secure
mountpoint -q /srv/secure || mount /dev/mapper/secure /srv/secure
chown root:root /srv /srv/secure && chmod 755 /srv /srv/secure

install -d -m 750 -o mysql -g mysql /srv/secure/mysql
install -d -m 700 -o root -g root /srv/secure/hosxp-backups
install -d -m 755 -o root -g root /srv/secure/sftp /srv/secure/sftp/hosxp
id hosxp-upload >/dev/null 2>&1 || useradd -m -s /sbin/nologin hosxp-upload
usermod -p '*' hosxp-upload
install -d -m 700 -o hosxp-upload -g hosxp-upload /srv/secure/sftp/hosxp/inbox
install -d -m 700 -o hosxp-upload -g hosxp-upload /home/hosxp-upload/.ssh
touch /home/hosxp-upload/.ssh/authorized_keys
chown hosxp-upload:hosxp-upload /home/hosxp-upload/.ssh/authorized_keys
chmod 600 /home/hosxp-upload/.ssh/authorized_keys

# Portal server account (ADR 0011): reads the status file, writes destroy requests, never sees the backups.
id portal-ops >/dev/null 2>&1 || useradd -m -s /sbin/nologin portal-ops
usermod -p '*' portal-ops
install -d -m 755 -o root -g root /srv/secure/ops
install -d -m 750 -o root -g portal-ops /srv/secure/ops/status
install -d -m 700 -o portal-ops -g portal-ops /srv/secure/ops/requests
install -d -m 700 -o portal-ops -g portal-ops /home/portal-ops/.ssh
touch /home/portal-ops/.ssh/authorized_keys
chown portal-ops:portal-ops /home/portal-ops/.ssh/authorized_keys
chmod 600 /home/portal-ops/.ssh/authorized_keys

semanage fcontext -a -t mysqld_db_t '/srv/secure/mysql(/.*)?' 2>/dev/null || semanage fcontext -m -t mysqld_db_t '/srv/secure/mysql(/.*)?'
mkdir -p /var/lib/mysql
mountpoint -q /var/lib/mysql || mount --bind /srv/secure/mysql /var/lib/mysql
restorecon -R /srv/secure /var/lib/mysql
[ -d /var/lib/mysql/mysql ] || mariadb-install-db --user=mysql --datadir=/var/lib/mysql >/dev/null
restorecon -R /var/lib/mysql
systemctl start mariadb

cat > /usr/local/sbin/replica-unlock <<'EOF'
#!/bin/bash
# After a reboot: unlock the encrypted volume, mount it, start MariaDB.
set -euo pipefail
[ -e /dev/mapper/secure ] || cryptsetup open /srv/secure.img secure
mountpoint -q /srv/secure || mount /dev/mapper/secure /srv/secure
mountpoint -q /var/lib/mysql || mount --bind /srv/secure/mysql /var/lib/mysql
restorecon -R /var/lib/mysql
systemctl start mariadb
systemctl start hosxp-offsite-store.service || true
df -h /srv/secure
EOF
chmod 700 /usr/local/sbin/replica-unlock

cat > /etc/ssh/sshd_config.d/20-hosxp-upload.conf <<'EOF'
# The HOSxP server's upload key may only use SFTP inside the inbox chroot (ADR 0010).
Match User hosxp-upload
    ForceCommand internal-sftp -u 077
    ChrootDirectory /srv/secure/sftp/hosxp
    AllowTcpForwarding no
    PermitTTY no
    X11Forwarding no
# The Portal server's key may only read status/ and write requests/ (ADR 0011).
Match User portal-ops
    ForceCommand internal-sftp -u 077
    ChrootDirectory /srv/secure/ops
    AllowTcpForwarding no
    PermitTTY no
    X11Forwarding no
EOF
if ! sshd -t; then rm -f /etc/ssh/sshd_config.d/20-hosxp-upload.conf; echo "sshd config invalid; removed" >&2; exit 1; fi
systemctl reload sshd

install -D -m 755 /tmp/hosxp_offsite.py /opt/hosxp-offsite/hosxp_offsite.py
cat > /etc/systemd/system/hosxp-offsite-store.service <<'EOF'
[Unit]
Description=Verify HOSxP backup uploads and prune the oldest when the volume is full
RequiresMountsFor=/srv/secure

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /opt/hosxp-offsite/hosxp_offsite.py store --inbox /srv/secure/sftp/hosxp/inbox --store /srv/secure/hosxp-backups --keep-min 2 --max-use-percent 85 --requests-dir /srv/secure/ops/requests --status /srv/secure/ops/status/status.json --history /srv/secure/hosxp-offsite-history.json
Nice=10
IOSchedulingClass=idle
EOF
cat > /etc/systemd/system/hosxp-offsite-store.timer <<'EOF'
[Unit]
Description=Verify HOSxP backup uploads every 10 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=10min

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now hosxp-offsite-store.timer
systemctl start hosxp-offsite-store.service

echo; echo "===== ผลลัพธ์ ====="
df -h /srv/secure /var/lib/mysql
mariadb -E -e "SELECT @@lower_case_table_names AS lctn, @@character_set_server AS charset, @@read_only AS read_only"
ls -ld /srv/secure/hosxp-backups /srv/secure/sftp/hosxp/inbox /srv/secure/ops/status /srv/secure/ops/requests
journalctl -u hosxp-offsite-store.service -n 1 --no-pager -o cat
systemctl is-active hosxp-offsite-store.timer
