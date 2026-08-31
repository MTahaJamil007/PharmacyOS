#!/bin/sh
set -eu
set -o pipefail

LOCAL_ROOT='/backups'
EXTERNAL_ROOT='/external-backups'
EXTERNAL_MARKER='.pharmacyos-backup-target'
HEALTH_FILE='/tmp/pharmacy-backup-health'
LOCK_FILE='/backups/.backup-service.lock'
DAILY_KEEP=7
WEEKLY_KEEP=4
MONTHLY_KEEP=3

log() {
  printf '%s %s\n' "$(date -Iseconds)" "$*"
}

require_environment() {
  if [ -z "${DATABASE_ADMIN_URL:-}" ]; then
    echo 'DATABASE_ADMIN_URL is required' >&2
    exit 1
  fi
  if [ -z "${DATABASE_URL:-}" ]; then
    echo 'DATABASE_URL is required for least-privilege restore validation' >&2
    exit 1
  fi
  if [ -z "${BACKUP_AGE_RECIPIENT:-}" ]; then
    echo 'BACKUP_AGE_RECIPIENT is required' >&2
    exit 1
  fi
  if [ -z "${BACKUP_AGE_IDENTITY_FILE:-}" ]; then
    echo 'BACKUP_AGE_IDENTITY_FILE is required' >&2
    exit 1
  fi

  if [ ! -r "$BACKUP_AGE_IDENTITY_FILE" ]; then
    echo "Backup identity is not readable: $BACKUP_AGE_IDENTITY_FILE" >&2
    exit 1
  fi

  case "${RESTORE_DRILL_DATABASE:-pharmacy_os_restore_drill}" in
    pharmacy_os|postgres|template0|template1|'')
      echo 'RESTORE_DRILL_DATABASE must be an isolated non-system database' >&2
      exit 1
      ;;
    *[!A-Za-z0-9_]*)
      echo 'RESTORE_DRILL_DATABASE may contain only letters, numbers, and underscores' >&2
      exit 1
      ;;
  esac

  schedule_hour="${BACKUP_SCHEDULE_HOUR:-1}"
  case "$schedule_hour" in
    ''|*[!0-9]*)
      echo 'BACKUP_SCHEDULE_HOUR must be an integer from 0 through 23' >&2
      exit 1
      ;;
  esac
  if [ "$schedule_hour" -gt 23 ]; then
    echo 'BACKUP_SCHEDULE_HOUR must be an integer from 0 through 23' >&2
    exit 1
  fi

  restore_day="${RESTORE_DRILL_DAY:-0}"
  case "$restore_day" in
    0|1|2|3|4|5|6) ;;
    *) echo 'RESTORE_DRILL_DAY must be an integer from 0 (Sunday) through 6' >&2; exit 1 ;;
  esac

  case "${BACKUP_RUN_ON_START:-true}" in
    true|false) ;;
    *) echo 'BACKUP_RUN_ON_START must be true or false' >&2; exit 1 ;;
  esac
}

record_start() {
  backup_type="$1"
  destination="$2"
  psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -Atq \
    --set=backup_type="$backup_type" \
    --set=destination="$destination" <<'SQL'
insert into backup_runs (backup_type, status, destination, encrypted)
values (:'backup_type', 'RUNNING', :'destination', true)
returning id;
SQL
}

record_success() {
  run_id="$1"
  size_bytes="$2"
  checksum="$3"
  psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -q \
    --set=run_id="$run_id" \
    --set=size_bytes="$size_bytes" \
    --set=checksum="$checksum" <<'SQL'
update backup_runs
set status = 'SUCCEEDED', size_bytes = :'size_bytes'::bigint,
    checksum = :'checksum', finished_at = now(), error_message = null
where id = :'run_id'::bigint and status = 'RUNNING';
SQL
}

record_failure() {
  run_id="$1"
  error_message="$2"
  psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -q \
    --set=run_id="$run_id" \
    --set=error_message="$error_message" <<'SQL'
update backup_runs
set status = 'FAILED', finished_at = now(), error_message = :'error_message'
where id = :'run_id'::bigint and status = 'RUNNING';
SQL
}

write_checksum() {
  backup_path="$1"
  checksum="$2"
  printf '%s  %s\n' "$checksum" "$(basename "$backup_path")" > "$backup_path.sha256" \
    || return 1
  chmod 0600 "$backup_path.sha256" || return 1
}

copy_encrypted_backup() {
  source_path="$1"
  destination_directory="$2"
  mkdir -p "$destination_directory" || return 1
  destination_path="$destination_directory/$(basename "$source_path")"
  temporary_path="$destination_path.incomplete"
  checksum_path="$destination_path.sha256"
  temporary_checksum_path="$checksum_path.incomplete"
  if ! cp "$source_path" "$temporary_path" \
    || ! cp "$source_path.sha256" "$temporary_checksum_path" \
    || ! chmod 0600 "$temporary_path" "$temporary_checksum_path" \
    || ! mv "$temporary_checksum_path" "$checksum_path" \
    || ! mv "$temporary_path" "$destination_path"; then
    rm -f -- "$temporary_path" "$temporary_checksum_path"
    return 1
  fi
}

prune_directory() {
  directory="$1"
  keep="$2"
  set -- "$directory"/*.dump.age
  if [ ! -e "$1" ]; then
    return
  fi

  while [ "$#" -gt "$keep" ]; do
    rm -f -- "$1" "$1.sha256" || return 1
    shift
  done
}

promote_backup() {
  source_path="$1"
  destination_root="$2"
  category="$3"
  copy_encrypted_backup "$source_path" "$destination_root/$category"
}

maintain_backup_set() {
  source_path="$1"
  destination_root="$2"
  weekday="$3"
  month_day="$4"

  if [ "$weekday" = '0' ]; then
    promote_backup "$source_path" "$destination_root" 'weekly' || return 1
  fi
  if [ "$month_day" = '01' ]; then
    promote_backup "$source_path" "$destination_root" 'monthly' || return 1
  fi

  prune_directory "$destination_root/daily" "$DAILY_KEEP" || return 1
  prune_directory "$destination_root/weekly" "$WEEKLY_KEEP" || return 1
  prune_directory "$destination_root/monthly" "$MONTHLY_KEEP" || return 1
}

external_destination_ready() {
  [ -f "$EXTERNAL_ROOT/$EXTERNAL_MARKER" ] && [ -w "$EXTERNAL_ROOT" ]
}

fail_run() {
  run_id="$1"
  failure_message="$2"
  if ! record_failure "$run_id" "$failure_message"; then
    log "Could not record failure state for backup run $run_id"
  fi
  log "Backup run $run_id failed: $failure_message"
}

perform_backup() {
  timestamp="$(date '+%Y%m%dT%H%M%S%z')"
  backup_name="pharmacy-os-$timestamp.dump.age"
  daily_directory="$LOCAL_ROOT/daily"
  final_path="$daily_directory/$backup_name"
  temporary_path="$LOCAL_ROOT/.$backup_name.incomplete"
  if ! mkdir -p "$daily_directory"; then
    log 'Could not create the local daily backup directory'
    return 1
  fi

  if ! run_id="$(record_start 'LOGICAL' "local-and-external:$backup_name")"; then
    log 'Could not record the start of the logical backup'
    return 1
  fi
  log "Starting encrypted logical backup run $run_id"

  if ! pg_dump "$DATABASE_ADMIN_URL" --format=custom --compress=6 --no-owner \
    | age --recipient "$BACKUP_AGE_RECIPIENT" --output "$temporary_path"; then
    rm -f -- "$temporary_path"
    fail_run "$run_id" 'pg_dump or age encryption failed' || true
    return 1
  fi

  if ! chmod 0600 "$temporary_path" || ! mv "$temporary_path" "$final_path"; then
    rm -f -- "$temporary_path"
    fail_run "$run_id" 'could not finalize the encrypted local backup' || true
    return 1
  fi
  if ! checksum="$(sha256sum "$final_path" | awk '{print $1}')" \
    || ! size_bytes="$(stat -c '%s' "$final_path")" \
    || ! write_checksum "$final_path" "$checksum"; then
    fail_run "$run_id" 'could not checksum the encrypted local backup' || true
    return 1
  fi

  weekday="$(date '+%w')"
  month_day="$(date '+%d')"
  if ! maintain_backup_set "$final_path" "$LOCAL_ROOT" "$weekday" "$month_day"; then
    fail_run "$run_id" 'local backup promotion or retention cleanup failed' || true
    return 1
  fi

  if ! external_destination_ready; then
    fail_run "$run_id" "external destination is missing $EXTERNAL_MARKER or is not writable; encrypted local copy retained" || true
    return 1
  fi

  if ! copy_encrypted_backup "$final_path" "$EXTERNAL_ROOT/daily"; then
    fail_run "$run_id" 'external daily copy failed; encrypted local copy retained' || true
    return 1
  fi

  if ! maintain_backup_set "$final_path" "$EXTERNAL_ROOT" "$weekday" "$month_day"; then
    fail_run "$run_id" 'external backup promotion or retention cleanup failed' || true
    return 1
  fi

  if ! record_success "$run_id" "$size_bytes" "$checksum"; then
    log "Backup completed, but run $run_id could not be marked successful"
    return 1
  fi
  log "Backup run $run_id succeeded: $backup_name ($size_bytes bytes)"
}

latest_local_backup() {
  latest=''
  for candidate in "$LOCAL_ROOT"/daily/*.dump.age; do
    [ -e "$candidate" ] || continue
    latest="$candidate"
  done
  printf '%s' "$latest"
}

drop_drill_database() {
  dropdb --if-exists --force --maintenance-db="$DATABASE_ADMIN_URL" \
    "${RESTORE_DRILL_DATABASE:-pharmacy_os_restore_drill}" >/dev/null 2>&1 || true
}

perform_restore_drill() {
  source_path="$(latest_local_backup)"
  if [ -z "$source_path" ]; then
    log 'Restore drill skipped: no local encrypted backup is available'
    return 1
  fi

  drill_database="${RESTORE_DRILL_DATABASE:-pharmacy_os_restore_drill}"
  restore_url="${DATABASE_ADMIN_URL%/*}/$drill_database"
  restore_app_url="${DATABASE_URL%/*}/$drill_database"
  if ! run_id="$(record_start 'RESTORE_DRILL' "database:$drill_database")"; then
    log 'Could not record the start of the restore drill'
    return 1
  fi
  started_at="$(date '+%s')"
  log "Starting restore drill run $run_id from $(basename "$source_path")"

  if ! (cd "$(dirname "$source_path")" && sha256sum -c "$(basename "$source_path").sha256" >/dev/null); then
    record_failure "$run_id" 'encrypted backup checksum validation failed'
    return 1
  fi

  drop_drill_database
  if ! createdb --maintenance-db="$DATABASE_ADMIN_URL" "$drill_database"; then
    record_failure "$run_id" 'could not create isolated restore-drill database'
    return 1
  fi

  restore_succeeded=true
  if ! age --decrypt --identity "$BACKUP_AGE_IDENTITY_FILE" "$source_path" \
    | pg_restore --exit-on-error --no-owner --dbname="$restore_url"; then
    restore_succeeded=false
  fi

  if [ "$restore_succeeded" = 'true' ]; then
    if ! validation="$(psql "$restore_app_url" -v ON_ERROR_STOP=1 -Atq <<'SQL'
select case
  when to_regclass('public.schema_migrations') is not null
   and to_regclass('public.sales') is not null
   and to_regclass('public.stock_movements') is not null
  then 1 else 0 end;
SQL
)"; then
      restore_succeeded=false
    elif [ "$validation" != '1' ]; then
      restore_succeeded=false
    fi
  fi

  drop_drill_database
  if [ "$restore_succeeded" != 'true' ]; then
    record_failure "$run_id" 'restore or post-restore validation failed'
    log "Restore drill run $run_id failed"
    return 1
  fi

  if ! checksum="$(sha256sum "$source_path" | awk '{print $1}')" \
    || ! size_bytes="$(stat -c '%s' "$source_path")"; then
    record_failure "$run_id" 'could not read the restored backup metadata' || true
    return 1
  fi
  elapsed="$(( $(date '+%s') - started_at ))"
  if [ "$elapsed" -ge 900 ]; then
    record_failure "$run_id" 'restore drill exceeded the 15-minute recovery target'
    log "Restore drill run $run_id exceeded the recovery target in ${elapsed}s"
    return 1
  fi
  if ! record_success "$run_id" "$size_bytes" "$checksum"; then
    log "Restore drill completed, but run $run_id could not be marked successful"
    return 1
  fi
  log "Restore drill run $run_id succeeded in ${elapsed}s"
}

with_lock() {
  action="$1"
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    log 'Another backup or restore operation is already running'
    exec 9>&-
    return 1
  fi

  action_status=0
  "$action" || action_status=$?
  flock -u 9 || true
  exec 9>&-
  return "$action_status"
}

run_scheduled_work() {
  with_lock perform_backup || true
  if [ "$(date '+%w')" = "${RESTORE_DRILL_DAY:-0}" ]; then
    with_lock perform_restore_drill || true
  fi
}

run_daemon() {
  last_run_date=''
  if [ "${BACKUP_RUN_ON_START:-true}" = 'true' ]; then
    run_scheduled_work
    last_run_date="$(date '+%F')"
  fi

  while true; do
    touch "$HEALTH_FILE"
    current_date="$(date '+%F')"
    current_hour="$(date '+%H' | sed 's/^0//')"
    current_hour="${current_hour:-0}"
    if [ "$current_date" != "$last_run_date" ] \
      && [ "$current_hour" -ge "${BACKUP_SCHEDULE_HOUR:-1}" ]; then
      run_scheduled_work
      last_run_date="$current_date"
    fi
    sleep 60
  done
}

export TZ="${BACKUP_TIMEZONE:-Asia/Karachi}"
require_environment
mkdir -p "$LOCAL_ROOT/daily" "$LOCAL_ROOT/weekly" "$LOCAL_ROOT/monthly"

case "${1:-daemon}" in
  daemon) run_daemon ;;
  backup) with_lock perform_backup ;;
  restore-drill) with_lock perform_restore_drill ;;
  *) echo "Usage: backup-service [daemon|backup|restore-drill]" >&2; exit 2 ;;
esac
