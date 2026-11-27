#!/usr/bin/env bash
# First-day hardening of the GDCC VM for the Portal database replica (ADR 0009,
# GDCC runbook section 0). Run as root on the VM, from an SSH session you keep open:
#
#   sudo bash vm-first-day.sh <admin-username> "<admin ssh public key>" [--with-mariadb]
#
# What it does, in order (each step is idempotent):
#   1. installs security updates
#   2. creates a named administrator with sudo and the given SSH key
#   3. sets a new random root password and prints it ONCE (store it in the Secrets Vault)
#   4. creates the no-shell `tunnel` account for the replication SSH tunnel
#   5. writes an sshd drop-in: no root login, no passwords, keys only; validates, then reloads
#   6. optionally installs MariaDB with replica.cnf (bound to 127.0.0.1, read-only)
# It never opens firewall ports and never touches disk encryption (see the runbook).
set -euo pipefail

usage() { sed -n '2,8p' "$0" >&2; exit 2; }
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
[ $# -ge 2 ] || usage
ADMIN="$1"; KEY="$2"; WITH_DB="${3:-}"
SSHD_DIR="${SSHD_CONFIG_DIR:-/etc/ssh/sshd_config.d}"
HERE="$(cd "$(dirname "$0")" && pwd)"

[[ "$ADMIN" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || { echo "invalid username: $ADMIN" >&2; exit 2; }
[ "$ADMIN" != root ] || { echo "the administrator must be a named person, not root" >&2; exit 2; }
printf '%s\n' "$KEY" | ssh-keygen -l -f - >/dev/null 2>&1 || { echo "not a valid SSH public key" >&2; exit 2; }

log() { printf '\n== %s\n' "$*"; }

if command -v apt-get >/dev/null; then PKG=apt; SUDO_GROUP=sudo
elif command -v dnf >/dev/null; then PKG=dnf; SUDO_GROUP=wheel
else echo "unsupported OS (need apt or dnf)" >&2; exit 1; fi

log "1/6 security updates"
if [ "${SKIP_UPDATES:-}" = 1 ]; then echo "skipped (SKIP_UPDATES=1)"
elif [ $PKG = apt ]; then DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get -y -qq upgrade
else dnf -y -q upgrade --security || dnf -y -q upgrade; fi

log "2/6 administrator $ADMIN"
id "$ADMIN" >/dev/null 2>&1 || useradd -m -s /bin/bash "$ADMIN"
usermod -aG "$SUDO_GROUP" "$ADMIN"
home="$(getent passwd "$ADMIN" | cut -d: -f6)"
install -d -m 700 -o "$ADMIN" -g "$ADMIN" "$home/.ssh"
touch "$home/.ssh/authorized_keys"
grep -qxF "$KEY" "$home/.ssh/authorized_keys" || printf '%s\n' "$KEY" >> "$home/.ssh/authorized_keys"
chown "$ADMIN:$ADMIN" "$home/.ssh/authorized_keys"; chmod 600 "$home/.ssh/authorized_keys"
# sudo still asks for the administrator's own password: set one now if missing.
if passwd -S "$ADMIN" 2>/dev/null | awk '{exit !($2 ~ /^(L|LK|NP)$/)}'; then
  admin_pw="$(openssl rand -base64 18)"
  echo "$ADMIN:$admin_pw" | chpasswd
  ADMIN_PW_SET=1
fi

log "3/6 new root password"
root_pw="$(openssl rand -base64 24)"
echo "root:$root_pw" | chpasswd

log "4/6 tunnel account (no shell)"
id tunnel >/dev/null 2>&1 || useradd -m -s /usr/sbin/nologin tunnel
install -d -m 700 -o tunnel -g tunnel /home/tunnel/.ssh
touch /home/tunnel/.ssh/authorized_keys; chown tunnel:tunnel /home/tunnel/.ssh/authorized_keys; chmod 600 /home/tunnel/.ssh/authorized_keys
echo "add the Portal server's tunnel key later, in the form of authorized_keys.example"

log "5/6 sshd: keys only, no root login"
mkdir -p "$SSHD_DIR"
cat > "$SSHD_DIR/10-gdcc-hardening.conf" <<'EOF'
# GDCC VM hardening (ADR 0009). Keys only; named administrators use sudo.
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
X11Forwarding no
AllowAgentForwarding no
# The tunnel account may forward ports (limits are in its authorized_keys); nobody else may.
AllowTcpForwarding no
Match User tunnel
    AllowTcpForwarding yes
    GatewayPorts no
    PermitTTY no
EOF
if grep -qiE '^\s*Include\s+/etc/ssh/sshd_config\.d/\*\.conf' /etc/ssh/sshd_config 2>/dev/null || [ -n "${SSHD_CONFIG_DIR:-}" ]; then :; else
  sed -i '1i Include /etc/ssh/sshd_config.d/*.conf' /etc/ssh/sshd_config
fi
if [ -z "${SKIP_SSHD_RELOAD:-}" ]; then
  sshd_bin="$(command -v sshd || echo /usr/sbin/sshd)"
  "$sshd_bin" -t || { echo "sshd config invalid; removing drop-in, nothing reloaded" >&2; rm -f "$SSHD_DIR/10-gdcc-hardening.conf"; exit 1; }
  systemctl reload ssh 2>/dev/null || systemctl reload sshd
fi

if [ "$WITH_DB" = "--with-mariadb" ]; then
  log "6/6 MariaDB replica server"
  if [ $PKG = apt ]; then DEBIAN_FRONTEND=noninteractive apt-get install -y -qq mariadb-server; else dnf -y -q install mariadb-server; fi
  conf_dir=/etc/mysql/mariadb.conf.d; [ -d "$conf_dir" ] || conf_dir=/etc/my.cnf.d
  install -m 644 "$HERE/replica.cnf.example" "$conf_dir/60-gdcc-replica.cnf"
  systemctl enable --now mariadb
  systemctl restart mariadb
  mariadb --version
  echo "primary must run the same major version (10.11); seed and CHANGE MASTER per setup-replica.sql.example"
else
  log "6/6 MariaDB skipped (add --with-mariadb)"
fi

cat <<EOF

================================================================
 DONE. Store these in the Secrets Vault NOW; they are not saved anywhere else.
   root password:   $root_pw
EOF
[ -n "${ADMIN_PW_SET:-}" ] && echo "   $ADMIN sudo password: $admin_pw"
cat <<EOF
 Then clear this terminal's scrollback.

 BEFORE closing this session: open a NEW terminal and log in as
   ssh $ADMIN@<vm>   then   sudo -v
 If that fails, fix it from this session (rm $SSHD_DIR/10-gdcc-hardening.conf; systemctl reload ssh).
 Still to do by hand: disk encryption for the data volume (runbook section 0.5).
================================================================
EOF
