#!/bin/bash
# HOSxP server: first copy of the hos database for the GDCC replica (ADR 0010).
# mariadb-dump --single-transaction takes no global lock: HOSxP keeps saving data
# throughout. Output is compressed on local disk, then sent to the GDCC inbox.
# Start it detached (survives logout), lowest CPU and disk priority:
#   sudo systemd-run --unit=hos-seed --nice=19 -p IOSchedulingClass=idle bash /root/hos-seed-dump.sh
# Watch:  journalctl -u hos-seed -f
set -euo pipefail
DB=${SEED_DB:-hos}
OUT=${SEED_OUT:-/var/tmp/hos-seed}
DEST=${SEED_DEST:-hosxp-upload@gdcc-vm}
KEY=/etc/hosxp-offsite/upload_ed25519
log() { echo "$(date '+%F %T') $*"; }

install -d -m 700 "$OUT"
FREE_GB=$(df -BG --output=avail "$OUT" | tail -1 | tr -dc 0-9)
[ "$FREE_GB" -ge "${SEED_MIN_FREE_GB:-150}" ] || { log "only ${FREE_GB} GB free in $OUT, need ${SEED_MIN_FREE_GB:-150}"; exit 1; }
if command -v zstd >/dev/null; then COMP=(zstd -q -T2 -3); EXT=zst
elif command -v pigz >/dev/null; then COMP=(pigz -1 -p 2); EXT=gz
else COMP=(gzip -1); EXT=gz; fi
NAME="hos-seed.sql.$EXT"
rm -f "$OUT"/hos-seed.*

mapfile -t IGNORE < <(mariadb -N -e "SELECT CONCAT('--ignore-table=', table_schema, '.', table_name) FROM information_schema.tables WHERE table_schema='$DB' AND table_name LIKE 'replicate\\_log%'")
log "dump of $DB started, skipping ${#IGNORE[@]} replicate_log tables, compressing with ${COMP[0]}"
mariadb-dump --default-character-set=binary --single-transaction --master-data=2 --gtid \
  --routines --triggers --events --hex-blob --quick --max-allowed-packet=1G \
  "${IGNORE[@]}" --databases "$DB" \
  | tee >(tail -n 30 > "$OUT/tail.sql") | "${COMP[@]}" > "$OUT/$NAME.part"
sleep 5
GTID=$(sed -n "s/^-- SET GLOBAL gtid_slave_pos='\(.*\)';$/\1/p" "$OUT/tail.sql")
grep -q '^-- Dump completed' "$OUT/tail.sql" || { log "dump did not complete"; exit 1; }
[ -n "$GTID" ] || { log "no GTID position in dump"; exit 1; }
mv "$OUT/$NAME.part" "$OUT/$NAME"
echo "$GTID" > "$OUT/hos-seed.gtid"
( cd "$OUT" && sha256sum "$NAME" > "$NAME.sha256" )
log "dump done: $(du -h "$OUT/$NAME" | cut -f1), GTID $GTID"
[ "${SEED_UPLOAD:-1}" = 1 ] || exit 0

for attempt in 1 2 3 4 5 6; do
  PUT=put; [ "$attempt" -gt 1 ] && PUT=reput
  log "upload attempt $attempt"
  if sftp -b - -i "$KEY" -o BatchMode=yes -o ServerAliveInterval=30 "$DEST" <<SFTP
$PUT $OUT/$NAME /inbox/.$NAME.part
put $OUT/$NAME.sha256 /inbox/$NAME.sha256
put $OUT/hos-seed.gtid /inbox/hos-seed.gtid
-rm /inbox/$NAME
rename /inbox/.$NAME.part /inbox/$NAME
SFTP
  then log "upload done: /inbox/$NAME"; exit 0; fi
  sleep 120
done
log "upload failed after 6 attempts; the dump stays in $OUT"
exit 1
