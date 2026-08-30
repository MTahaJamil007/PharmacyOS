$ErrorActionPreference = 'Stop'

$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$migrationDirectory = Resolve-Path (Join-Path $repositoryRoot 'packages\database\migrations')
$containerName = 'pharmacyos-fixture-check-' + [Guid]::NewGuid().ToString('N').Substring(0, 10)
$smokePassword = 'fixture-smoke-only'

if (-not $containerName.StartsWith('pharmacyos-fixture-check-')) {
  throw 'Refusing to manage an unexpected container name.'
}

try {
  docker run --detach --name $containerName --publish '127.0.0.1::5432' `
    --env POSTGRES_PASSWORD=$smokePassword --env POSTGRES_DB=pharmacy_os_check `
    postgres:18-alpine | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not start disposable PostgreSQL container.' }

  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    docker exec $containerName pg_isready --username postgres --dbname pharmacy_os_check | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'Disposable PostgreSQL did not become ready.' }

  Get-ChildItem -LiteralPath $migrationDirectory -Filter '*.sql' |
    Sort-Object Name |
    ForEach-Object {
      Get-Content -LiteralPath $_.FullName -Raw |
        docker exec --interactive $containerName psql `
          --username postgres --dbname pharmacy_os_check --set ON_ERROR_STOP=1 | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "Migration failed: $($_.Name)" }
    }

  $portOutput = docker port $containerName '5432/tcp'
  if ($LASTEXITCODE -ne 0 -or -not $portOutput) { throw 'Could not resolve disposable database port.' }
  $databasePort = ($portOutput.Trim() -split ':')[-1]
  $env:DATABASE_URL = "postgres://postgres:$smokePassword@127.0.0.1:$databasePort/pharmacy_os_check"
  $env:NODE_ENV = 'development'
  $env:ALLOW_DEVELOPMENT_SEED = 'true'
  $env:DEVELOPMENT_SEED_PASSWORD = 'Development-Smoke-Only-2026!'
  $env:DEVELOPMENT_MEDICINE_COUNT = '500'

  Push-Location $repositoryRoot
  try {
    npm run db:seed
    if ($LASTEXITCODE -ne 0) { throw 'Role and permission seed failed.' }
    npm run db:seed:development
    if ($LASTEXITCODE -ne 0) { throw 'Development fixture seed failed.' }
  }
  finally {
    Pop-Location
  }

  docker exec $containerName psql --username postgres --dbname pharmacy_os_check `
    --tuples-only --command "select count(*) as medicines from medicines where sku like 'DEV-%'; select count(*) as sales from sales where client_request_id like 'development-history-%';"
  if ($LASTEXITCODE -ne 0) { throw 'Fixture verification query failed.' }
}
finally {
  Remove-Item Env:DATABASE_URL, Env:NODE_ENV, Env:ALLOW_DEVELOPMENT_SEED, `
    Env:DEVELOPMENT_SEED_PASSWORD, Env:DEVELOPMENT_MEDICINE_COUNT -ErrorAction SilentlyContinue
  $knownContainer = docker ps --all --quiet --filter "name=^/$containerName$"
  if ($knownContainer) { docker rm --force $containerName | Out-Null }
}
