$ErrorActionPreference = 'Stop'

$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$migrationDirectory = Resolve-Path (Join-Path $repositoryRoot 'packages\database\migrations')
$phase2Container = 'pharmacyos-migration-check-' + [Guid]::NewGuid().ToString('N').Substring(0, 10)

if (-not $phase2Container.StartsWith('pharmacyos-migration-check-')) {
  throw 'Refusing to manage an unexpected container name.'
}

try {
  docker run --detach --name $phase2Container `
    --env POSTGRES_PASSWORD=phase2-smoke-only `
    --env POSTGRES_DB=pharmacy_os_check `
    postgres:18-alpine | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not start disposable PostgreSQL container.' }

  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    docker exec $phase2Container pg_isready --username postgres --dbname pharmacy_os_check | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'Disposable PostgreSQL did not become ready.' }

  Get-ChildItem -LiteralPath $migrationDirectory -Filter '*.sql' |
    Sort-Object Name |
    ForEach-Object {
      Get-Content -LiteralPath $_.FullName -Raw |
        docker exec --interactive $phase2Container psql `
          --username postgres --dbname pharmacy_os_check --set ON_ERROR_STOP=1 | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "Migration failed: $($_.Name)" }
    }

  docker exec $phase2Container psql --username postgres --dbname pharmacy_os_check `
    --tuples-only --command "select count(*) from information_schema.tables where table_schema = 'public';"
  if ($LASTEXITCODE -ne 0) { throw 'Schema smoke query failed.' }
}
finally {
  $knownContainer = docker ps --all --quiet --filter "name=^/$phase2Container$"
  if ($knownContainer) {
    docker rm --force $phase2Container | Out-Null
  }
}
