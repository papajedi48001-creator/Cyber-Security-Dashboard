#!/bin/sh
# Creates .env.docker with fresh random secrets. Run from deploy/local.
set -eu
[ -f .env.docker ] && { echo ".env.docker already exists; leaving it unchanged."; exit 0; }
pw() { openssl rand -base64 24 | tr -dc 'A-Za-z0-9'; }
db=$(pw); root=$(pw)
sed -e "s|MARIADB_PASSWORD=CHANGE_ME|MARIADB_PASSWORD=$db|" \
    -e "s|MARIADB_ROOT_PASSWORD=CHANGE_ME|MARIADB_ROOT_PASSWORD=$root|" \
    -e "s|portal:CHANGE_ME@|portal:$db@|" \
    -e "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" \
    -e "s|^TOTP_ENCRYPTION_KEY=.*|TOTP_ENCRYPTION_KEY=$(openssl rand -base64 32)|" \
    .env.docker.example > .env.docker
echo "Created .env.docker with new secrets."
