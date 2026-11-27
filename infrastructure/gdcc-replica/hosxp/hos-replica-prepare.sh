#!/bin/bash
# HOSxP server: prepare replication of the hos database to the GDCC replica (ADR 0010).
#   - replication-only account repl_gdcc@127.0.0.1 (reached only through the SSH tunnel)
#   - SSH key and systemd unit for the tunnel (installed, NOT started)
#   - a handoff file for the GDCC VM with the tunnel key and the account password
# Run once:  sudo bash hos-replica-prepare.sh     Safe to run again.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
[ -f /etc/ssh/ssh_config.d/50-gdcc-vm.conf ] || { echo "run hos-offsite-setup.sh first (gdcc-vm host key)"; exit 1; }
OWNER="${SUDO_USER:-root}"; OWNER_HOME=$(getent passwd "$OWNER" | cut -d: -f6)
PASSFILE=/etc/hosxp-offsite/repl_gdcc.pass

echo "== 1. replication account"
if [ ! -s "$PASSFILE" ]; then
  ( umask 077; openssl rand -base64 30 | tr -d '/+=\n' | cut -c1-32 > "$PASSFILE" )
fi
chmod 600 "$PASSFILE"
PASS=$(cat "$PASSFILE")
mariadb <<SQL
CREATE USER IF NOT EXISTS 'repl_gdcc'@'127.0.0.1' IDENTIFIED BY '$PASS';
ALTER USER 'repl_gdcc'@'127.0.0.1' IDENTIFIED BY '$PASS';
GRANT REPLICATION SLAVE ON *.* TO 'repl_gdcc'@'127.0.0.1';
SQL
WHO=$(mariadb -h127.0.0.1 -P3306 -urepl_gdcc -p"$PASS" -N -e "SELECT CURRENT_USER()")
[ "$WHO" = "repl_gdcc@127.0.0.1" ] || { echo "login test returned '$WHO' (another account matched first). Send this to Claude."; exit 2; }
echo "OK: $WHO (REPLICATION SLAVE only)"

echo "== 2. tunnel key"
[ -f /etc/hosxp-offsite/tunnel_ed25519 ] || ssh-keygen -q -t ed25519 -N '' -C "hosxp-tunnel@$(hostname -s)" -f /etc/hosxp-offsite/tunnel_ed25519
chmod 600 /etc/hosxp-offsite/tunnel_ed25519

echo "== 3. tunnel service (installed, not started)"
cat > /etc/systemd/system/gdcc-hosxp-tunnel.service <<'UNIT'
[Unit]
Description=SSH tunnel: GDCC replica reads the hos binlog through 127.0.0.1:3317 on the VM (ADR 0010)
Wants=network-online.target
After=network-online.target mariadb.service

[Service]
ExecStart=/usr/bin/ssh -N -i /etc/hosxp-offsite/tunnel_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes \
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -R 127.0.0.1:3317:127.0.0.1:3306 hosxp-tunnel@gdcc-vm
Restart=always
RestartSec=30
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable gdcc-hosxp-tunnel.service >/dev/null

echo "== 4. handoff file for the GDCC VM"
HANDOFF="$OWNER_HOME/gdcc-replica-handoff.txt"
( umask 077; { echo "TUNNEL_KEY=$(cat /etc/hosxp-offsite/tunnel_ed25519.pub)"; echo "REPL_PASS=$PASS"; } > "$HANDOFF" )
chown "$OWNER" "$HANDOFF"
echo "OK: $HANDOFF (contains a password: it is deleted on the VM after use)"
echo
echo "DONE on HOSxP. Next: copy the handoff file to the VM from Windows PowerShell."
