#!/bin/sh
set -eu

if [ "${1:-}" = 'keygen' ]; then
  identity_path="${2:-/keys/backup-age-identity.txt}"
  recipient_path="${3:-/keys/backup-age-recipient.txt}"
  mkdir -p "$(dirname "$identity_path")" "$(dirname "$recipient_path")"
  age-keygen -o "$identity_path"
  sed -n 's/^# public key: //p' "$identity_path" > "$recipient_path"
  chmod 0600 "$identity_path"
  chmod 0644 "$recipient_path"
  echo "Created age identity at $identity_path and recipient at $recipient_path"
  exit 0
fi

install -d -o backup -g backup -m 0700 /backups
touch /tmp/pharmacy-backup-health
chown backup:backup /tmp/pharmacy-backup-health

exec su-exec backup /usr/local/bin/backup-service "$@"
