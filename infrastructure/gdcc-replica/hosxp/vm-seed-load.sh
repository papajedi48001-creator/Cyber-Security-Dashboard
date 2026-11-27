#!/bin/bash
# GDCC VM: load the first copy of hos and start replication connection 'hosxp' (ADR 0010).
# Start detached:  sudo systemd-run --unit=hos-seed-load bash /usr/local/sbin/vm-seed-load.sh
# Watch:           sudo journalctl -u hos-seed-load -f
# Catch-up runs with slave_exec_mode=IDEMPOTENT (the MyISAM log tables were dumped
# without a lock); switch to STRICT once Seconds_Behind_Master reaches 0.
set -euo pipefail
INBOX=${SEED_INBOX:-/srv/secure/sftp/hosxp/inbox}
TUNNEL_PORT=${SEED_TUNNEL_PORT:-3317}
log() { echo "$(date '+%F %T') $*"; }

cd "$INBOX"
NAME=""
for f in hos-seed.sql.zst hos-seed.sql.gz; do [ -f "$f" ] && NAME=$f && break; done
[ -n "$NAME" ] && [ -f "$NAME.sha256" ] && [ -f hos-seed.gtid ] || { log "seed files not complete in $INBOX"; exit 1; }
GTID=$(cat hos-seed.gtid)
[[ "$GTID" =~ ^[0-9]+-[0-9]+-[0-9]+(,[0-9]+-[0-9]+-[0-9]+)*$ ]] || { log "bad GTID '$GTID'"; exit 1; }
log "checking SHA-256 of $NAME"
sha256sum -c --quiet "$NAME.sha256"
if [ -n "$(mariadb -N -e "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='hos'")" ]; then
  log "database hos already exists on the replica; drop it first if a reload is intended"; exit 1
fi
case "$NAME" in *.zst) DECOMP=(zstd -dc);; *) DECOMP=(gzip -dc);; esac

log "loading $NAME (several hours)"
"${DECOMP[@]}" "$NAME" | mariadb --default-character-set=binary --max-allowed-packet=1G
log "load done; tables in hos: $(mariadb -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='hos'")"

PASS=$(cat /root/.hosxp-repl.pass)
mariadb <<SQL
STOP ALL SLAVES;
SET GLOBAL gtid_slave_pos = '$GTID';
CHANGE MASTER 'hosxp' TO MASTER_HOST='127.0.0.1', MASTER_PORT=$TUNNEL_PORT, MASTER_USER='repl_gdcc',
  MASTER_PASSWORD='$PASS', MASTER_USE_GTID=slave_pos, MASTER_CONNECT_RETRY=30;
SET GLOBAL slave_exec_mode = 'IDEMPOTENT';
START SLAVE 'hosxp';
SQL
sleep 20
mariadb -e "SHOW SLAVE 'hosxp' STATUS\G" | grep -E 'Slave_IO_Running|Slave_SQL_Running|Seconds_Behind_Master|Gtid_IO_Pos|Last_.*Error'
log "replication 'hosxp' started from $GTID (IDEMPOTENT catch-up)"
