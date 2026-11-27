#!/bin/sh
# Consistent dump of the Portal MariaDB for gdcc_backup.py (ADR 0009).
# Usage: dump-portal-db.sh <option-file> <output-dir>
# The option file holds the dump account ([client] user/password), mode 0400.
# The account needs SELECT, SHOW VIEW, TRIGGER, EVENT, LOCK TABLES only.
set -eu
defaults="$1"
out="$2"
umask 077
mkdir -p "$out"
tmp="$out/.portal.sql.gz.tmp"
mariadb-dump --defaults-extra-file="$defaults" --single-transaction --routines --triggers --events \
  --databases portal | gzip -c > "$tmp"
gzip -t "$tmp"
mv -f "$tmp" "$out/portal.sql.gz"
