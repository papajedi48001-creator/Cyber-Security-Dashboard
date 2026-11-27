#!/bin/bash
# GDCC VM: accept the HOSxP tunnel and store the replication password (ADR 0010).
# Needs ~/gdcc-replica-handoff.txt (copied from the HOSxP server) and vm-seed-load.sh next to this script.
# Run:  sudo bash vm-replica-prepare.sh     Safe to run again.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
OWNER="${SUDO_USER:-root}"; OWNER_HOME=$(getent passwd "$OWNER" | cut -d: -f6)
HANDOFF="$OWNER_HOME/gdcc-replica-handoff.txt"
[ -f "$HANDOFF" ] || { echo "$HANDOFF not found"; exit 1; }
mountpoint -q /var/lib/mysql && systemctl is-active -q mariadb || { echo "encrypted volume locked or MariaDB stopped: run sudo replica-unlock first"; exit 1; }
KEY=$(sed -n 's/^TUNNEL_KEY=//p' "$HANDOFF"); PASS=$(sed -n 's/^REPL_PASS=//p' "$HANDOFF")
case "$KEY" in ssh-ed25519\ *) ;; *) echo "handoff file has no tunnel key"; exit 1;; esac
[ ${#PASS} -ge 20 ] || { echo "handoff file has no password"; exit 1; }

echo "== 1. tunnel account: may only open 127.0.0.1:3317, no shell, no commands"
id hosxp-tunnel >/dev/null 2>&1 || useradd -m -s /sbin/nologin hosxp-tunnel
usermod -p '*' hosxp-tunnel
install -d -m 700 -o hosxp-tunnel -g hosxp-tunnel /home/hosxp-tunnel/.ssh
echo "restrict,port-forwarding,permitlisten=\"127.0.0.1:3317\",command=\"/bin/false\" $KEY" > /home/hosxp-tunnel/.ssh/authorized_keys
chown hosxp-tunnel:hosxp-tunnel /home/hosxp-tunnel/.ssh/authorized_keys; chmod 600 /home/hosxp-tunnel/.ssh/authorized_keys
ssh-keygen -lf /home/hosxp-tunnel/.ssh/authorized_keys
# Remote forwards only (-R); no local forwards (-L), no TTY, no X11.
cat > /etc/ssh/sshd_config.d/21-hosxp-tunnel.conf <<'CONF'
Match User hosxp-tunnel
    AllowTcpForwarding remote
    PermitTTY no
    X11Forwarding no
    ForceCommand /bin/false
CONF
if ! sshd -t; then rm -f /etc/ssh/sshd_config.d/21-hosxp-tunnel.conf; echo "sshd config invalid; removed"; exit 1; fi
systemctl reload sshd

echo "== 2. replication password (root only)"
( umask 077; printf '%s' "$PASS" > /root/.hosxp-repl.pass )
install -m 700 -o root -g root "$HERE/vm-seed-load.sh" /usr/local/sbin/vm-seed-load.sh
shred -u "$HANDOFF" 2>/dev/null || rm -f "$HANDOFF"
echo "OK: handoff file deleted"
echo
echo "DONE on the VM. Next: start the tunnel on HOSxP, then test from here:"
echo "  sudo bash -c 'mariadb -h127.0.0.1 -P3317 -urepl_gdcc -p\"\$(cat /root/.hosxp-repl.pass)\" -N -e \"SELECT @@hostname, @@gtid_current_pos\"'"
