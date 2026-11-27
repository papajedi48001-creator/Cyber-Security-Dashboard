#!/usr/bin/env bash
# End-to-end rehearsal of the GDCC Portal database replica over an SSH reverse
# tunnel (ADR 0009), on one disposable machine:
#   "primary" MariaDB  <- autossh -R/-L ->  sshd ("GDCC VM")  -> "replica" MariaDB
# It uses the committed primary.cnf.example, replica.cnf.example and the
# authorized_keys restrictions, synthetic data only, and verifies:
#   1. replication over TLS with server-certificate verification through the tunnel
#   2. the replica is read-only and copies only the portal database
#   3. the monitor-only account reads SHOW REPLICA STATUS through the -L forward
#   4. the tunnel key cannot open any other port
#   5. after the tunnel drops, the replica reports broken, then catches up when it returns
# Requires: mariadbd, mariadb-install-db, mariadb, sshd, ssh, autossh, openssl.
# Usage: run-lab.sh [workdir]   (exit 0 = all checks passed)
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${1:-$(mktemp -d)}"
mkdir -p "$WORK"
P_PORT=23306 R_PORT=23307 SSH_PORT=22222 TUN_R=23406 TUN_L=23416
RUN_USER="$(id -un)"
PIDS=()

log() { printf '[lab] %s\n' "$*"; }
fail() { printf '[lab] FAIL: %s\n' "$*" >&2; exit 1; }
cleanup() {
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  [ -n "${TUNNEL_PID:-}" ] && kill "$TUNNEL_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT

sql() { local port=$1; shift; mariadb --protocol=socket -S "$WORK/$port.sock" -uroot -N -B "$@"; }
# One field of SHOW SLAVE STATUS on the replica (root, local socket).
replica_field() {
  mariadb --protocol=socket -S "$WORK/$R_PORT.sock" -uroot -e "SHOW SLAVE STATUS\G" |
    awk -F': ' -v f="$1" '{ k=$1; gsub(/^ +/, "", k) } k == f { print $2 }'
}
portal_monitor_state() {
  (cd "$PORTAL_DIR" && PORTAL_REPLICA_URL="mysql://portal-monitor:lab-only-monitor@127.0.0.1:$TUN_L/" npx tsx -e '
    import { createReplicaMonitor, InMemoryReplicaStore } from "./src/lib/replica/service";
    import { replicaStatusReader } from "./src/lib/db/replica-store";
    createReplicaMonitor({ fetchStatus: replicaStatusReader(process.env.PORTAL_REPLICA_URL!), store: new InMemoryReplicaStore() })
      .check().then(({ check }) => { console.log(check.state); process.exit(0); });
  ')
}

# --- TLS: lab CA and a primary certificate for portal-db-primary + 127.0.0.1 ---
log "creating lab CA and primary certificate"
mkdir -p "$WORK/tls"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=lab-ca" \
  -keyout "$WORK/tls/ca.key" -out "$WORK/tls/ca.crt" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj "/CN=portal-db-primary" \
  -keyout "$WORK/tls/primary.key" -out "$WORK/tls/primary.csr" 2>/dev/null
printf 'subjectAltName=DNS:portal-db-primary,IP:127.0.0.1\n' > "$WORK/tls/san.ext"
openssl x509 -req -in "$WORK/tls/primary.csr" -CA "$WORK/tls/ca.crt" -CAkey "$WORK/tls/ca.key" \
  -CAcreateserial -days 2 -extfile "$WORK/tls/san.ext" -out "$WORK/tls/primary.crt" 2>/dev/null
chmod 644 "$WORK"/tls/*

# --- two MariaDB servers from the committed example configs ---
start_db() {
  local name=$1 port=$2 cnf=$3
  mkdir -p "$WORK/$name"
  mariadb-install-db --no-defaults --user="$RUN_USER" --datadir="$WORK/$name" --auth-root-authentication-method=socket >/dev/null
  sed -e "s#/etc/mysql/tls/ca.crt#$WORK/tls/ca.crt#" \
      -e "s#/etc/mysql/tls/portal-db-primary.crt#$WORK/tls/primary.crt#" \
      -e "s#/etc/mysql/tls/portal-db-primary.key#$WORK/tls/primary.key#" "$cnf" > "$WORK/$name.cnf"
  mariadbd --defaults-file="$WORK/$name.cnf" --user="$RUN_USER" --datadir="$WORK/$name" \
    --port="$port" --socket="$WORK/$port.sock" --pid-file="$WORK/$name.pid" \
    --log-error="$WORK/$name.err" --skip-grant-tables=0 &
  PIDS+=($!)
  for _ in $(seq 60); do sql "$port" -e "SELECT 1" >/dev/null 2>&1 && return 0; sleep 0.5; done
  cat "$WORK/$name.err" >&2; fail "$name did not start"
}
log "starting primary and replica MariaDB"
start_db primary $P_PORT "$HERE/primary.cnf.example"
start_db replica $R_PORT "$HERE/replica.cnf.example"

# --- sshd standing in for the GDCC VM, with the committed key restrictions ---
log "starting sshd with restricted tunnel key"
mkdir -p "$WORK/ssh"
ssh-keygen -q -t ed25519 -N "" -f "$WORK/ssh/host_ed25519"
ssh-keygen -q -t ed25519 -N "" -f "$WORK/ssh/tunnel_ed25519"
restrictions="$(grep -o '^restrict[^ ]*' "$HERE/authorized_keys.example")"
restrictions="${restrictions//13306/$TUN_R}"
restrictions="${restrictions//:3306/:$R_PORT}"
printf '%s %s\n' "$restrictions" "$(cut -d' ' -f1,2 "$WORK/ssh/tunnel_ed25519.pub")" > "$WORK/ssh/authorized_keys"
chmod 600 "$WORK/ssh/authorized_keys"
mkdir -p /run/sshd 2>/dev/null || true
cat > "$WORK/ssh/sshd_config" <<EOF
Port $SSH_PORT
ListenAddress 127.0.0.1
HostKey $WORK/ssh/host_ed25519
AuthorizedKeysFile $WORK/ssh/authorized_keys
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
StrictModes no
PidFile $WORK/ssh/sshd.pid
EOF
/usr/sbin/sshd -f "$WORK/ssh/sshd_config" -D -E "$WORK/ssh/sshd.log" &
PIDS+=($!)
sleep 1
printf '[127.0.0.1]:%s %s\n' "$SSH_PORT" "$(cut -d' ' -f1,2 "$WORK/ssh/host_ed25519.pub")" > "$WORK/ssh/known_hosts"

start_tunnel() {
  AUTOSSH_GATETIME=0 autossh -M 0 -N \
    -o ServerAliveInterval=5 -o ServerAliveCountMax=2 -o ExitOnForwardFailure=yes \
    -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$WORK/ssh/known_hosts" -o BatchMode=yes \
    -i "$WORK/ssh/tunnel_ed25519" -p "$SSH_PORT" \
    -R "127.0.0.1:$TUN_R:127.0.0.1:$P_PORT" -L "127.0.0.1:$TUN_L:127.0.0.1:$R_PORT" \
    "$RUN_USER@127.0.0.1" &
  TUNNEL_PID=$!
  for _ in $(seq 30); do
    (echo > "/dev/tcp/127.0.0.1/$TUN_R") 2>/dev/null && (echo > "/dev/tcp/127.0.0.1/$TUN_L") 2>/dev/null && return 0
    sleep 0.5
  done
  cat "$WORK/ssh/sshd.log" >&2; fail "tunnel did not come up"
}
log "opening SSH tunnel (-R replication, -L monitoring)"
start_tunnel

# --- check 4: the tunnel key cannot forward anywhere else ---
if ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$WORK/ssh/known_hosts" \
     -o ExitOnForwardFailure=yes -i "$WORK/ssh/tunnel_ed25519" -p "$SSH_PORT" -N \
     -L "127.0.0.1:23999:127.0.0.1:$P_PORT" "$RUN_USER@127.0.0.1" -o ConnectTimeout=5 & then
  probe=$!; sleep 2
  if (echo > /dev/tcp/127.0.0.1/23999) 2>/dev/null && mariadb -h127.0.0.1 -P23999 -uroot -e "SELECT 1" >/dev/null 2>&1; then
    kill $probe 2>/dev/null; fail "tunnel key opened a port outside permitopen"
  fi
  kill $probe 2>/dev/null || true
fi
if ssh -o BatchMode=yes -o UserKnownHostsFile="$WORK/ssh/known_hosts" -i "$WORK/ssh/tunnel_ed25519" \
     -p "$SSH_PORT" "$RUN_USER@127.0.0.1" true >/dev/null 2>&1; then
  out="$(ssh -o BatchMode=yes -o UserKnownHostsFile="$WORK/ssh/known_hosts" -i "$WORK/ssh/tunnel_ed25519" -p "$SSH_PORT" "$RUN_USER@127.0.0.1" 'echo SHELL_OK' 2>/dev/null || true)"
  [ "$out" != "SHELL_OK" ] || fail "tunnel key got a shell"
fi
log "ok: tunnel key limited to the two forwards, no shell"

# --- seed primary with synthetic data and accounts from setup-replica.sql.example ---
log "creating synthetic portal data and replication account on primary"
sql $P_PORT <<'EOF'
CREATE DATABASE portal;
CREATE TABLE portal.Incident (id INT PRIMARY KEY, title VARCHAR(100)) ENGINE=InnoDB;
INSERT INTO portal.Incident VALUES (1, 'synthetic incident 1');
CREATE DATABASE other_db;
CREATE TABLE other_db.t (id INT PRIMARY KEY);
CREATE USER 'repl'@'127.0.0.1' IDENTIFIED BY 'lab-only-repl' REQUIRE SSL;
GRANT REPLICATION SLAVE ON *.* TO 'repl'@'127.0.0.1';
EOF
mariadb-dump --protocol=socket -S "$WORK/$P_PORT.sock" -uroot --single-transaction --gtid --master-data=1 \
  --databases portal > "$WORK/seed.sql"
sql $R_PORT < "$WORK/seed.sql"

log "configuring replica (TLS verify on, GTID) through the tunnel"
sql $R_PORT <<EOF
CHANGE MASTER TO MASTER_HOST='127.0.0.1', MASTER_PORT=$TUN_R, MASTER_USER='repl',
  MASTER_PASSWORD='lab-only-repl', MASTER_SSL=1, MASTER_SSL_CA='$WORK/tls/ca.crt',
  MASTER_SSL_VERIFY_SERVER_CERT=1, MASTER_CONNECT_RETRY=2, MASTER_USE_GTID=slave_pos;
START SLAVE;
CREATE USER 'portal-monitor'@'127.0.0.1' IDENTIFIED BY 'lab-only-monitor';
GRANT SLAVE MONITOR ON *.* TO 'portal-monitor'@'127.0.0.1';
CREATE USER 'app'@'localhost' IDENTIFIED BY 'lab-only-app';
GRANT ALL ON portal.* TO 'app'@'localhost';
EOF

wait_for() { # port query expected tries
  for _ in $(seq "$4"); do [ "$(sql "$1" -e "$2" 2>/dev/null)" = "$3" ] && return 0; sleep 1; done
  return 1
}
status_field() {
  mariadb -h127.0.0.1 -P$TUN_L -uportal-monitor -plab-only-monitor -e "SHOW REPLICA STATUS\G" 2>/dev/null |
    awk -F': ' -v f="$1" '{ k=$1; gsub(/^ +/, "", k) } k == f { print $2 }'
}

# --- check 1: replication through the tunnel with TLS ---
sql $P_PORT -e "INSERT INTO portal.Incident VALUES (2, 'synthetic incident 2'); INSERT INTO other_db.t VALUES (1);"
wait_for $R_PORT "SELECT COUNT(*) FROM portal.Incident" 2 30 || { sql $R_PORT -e "SHOW SLAVE STATUS\G" >&2; fail "row did not replicate"; }
# repl is REQUIRE SSL, so a working connection is a TLS connection; also confirm verification is on.
[ "$(replica_field Master_SSL_Allowed)" = "Yes" ] || fail "replication is not using TLS"
[ "$(replica_field Master_SSL_Verify_Server_Cert)" = "Yes" ] || fail "server certificate not verified"
log "ok: change replicated through the tunnel with TLS and certificate verification"

# --- check 2: read-only replica, portal database only ---
if mariadb --protocol=socket -S "$WORK/$R_PORT.sock" -uapp -plab-only-app -e "INSERT INTO portal.Incident VALUES (9,'x')" 2>/dev/null; then
  fail "replica accepted an application write"
fi
[ "$(sql $R_PORT -e "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='other_db'")" = "0" ] || fail "non-portal database was replicated"
[ "$(sql $R_PORT -e "SELECT COUNT(*) FROM mysql.user WHERE user='repl'")" = "0" ] || fail "primary accounts were replicated"
log "ok: replica is read-only and holds only the portal database"

# --- check 3: monitor-only account through the -L forward ---
[ "$(status_field Slave_IO_Running)" = "Yes" ] && [ "$(status_field Slave_SQL_Running)" = "Yes" ] || fail "monitor could not read a running replica"
if mariadb -h127.0.0.1 -P$TUN_L -uportal-monitor -plab-only-monitor -e "SELECT * FROM portal.Incident" >/dev/null 2>&1; then
  fail "monitor account can read Portal data"
fi
if [ -n "${PORTAL_DIR:-}" ]; then
  state="$(portal_monitor_state)"
  [ "$state" = "healthy" ] || fail "Portal monitor reported $state for a running replica"
  log "ok: Portal replica monitor reports healthy through the tunnel"
fi
log "ok: monitor account reads replica status only"

# --- check 5: tunnel drop and recovery ---
log "dropping the tunnel"
kill "$TUNNEL_PID"; wait "$TUNNEL_PID" 2>/dev/null || true; TUNNEL_PID=""
sql $P_PORT -e "INSERT INTO portal.Incident VALUES (3, 'written while tunnel down')"
io=""
for _ in $(seq 40); do
  io="$(replica_field Slave_IO_Running)"
  [ -n "$io" ] && [ "$io" != "Yes" ] && break
  sleep 1
done
[ -n "$io" ] && [ "$io" != "Yes" ] || fail "replica still reports IO thread '$io' with the tunnel down"
log "ok: replica reports IO thread '$io' while the tunnel is down"
if [ -n "${PORTAL_DIR:-}" ]; then
  # The monitor forward is down too, so the Portal must see the replica as unavailable.
  state="$(portal_monitor_state)"
  [ "$state" = "unavailable" ] || fail "Portal monitor reported $state with the tunnel down"
  log "ok: Portal replica monitor reports unavailable while the tunnel is down"
fi
start_tunnel
wait_for $R_PORT "SELECT COUNT(*) FROM portal.Incident" 3 60 || fail "replica did not catch up after the tunnel returned"
log "ok: replica caught up after the tunnel returned"

log "ALL CHECKS PASSED"
