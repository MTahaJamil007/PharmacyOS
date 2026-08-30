#!/bin/sh
set -eu

if [ -z "${POSTGRES_APP_PASSWORD:-}" ]; then
  echo 'POSTGRES_APP_PASSWORD is required' >&2
  exit 1
fi

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  --set=app_password="$POSTGRES_APP_PASSWORD" <<'SQL'
select format('create role pharmacy_app login password %L', :'app_password')
where not exists (select 1 from pg_roles where rolname = 'pharmacy_app')
\gexec
SQL
