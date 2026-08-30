[CmdletBinding()]
param(
  [string]$OutputDirectory = 'infra/docker/secrets'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$requestedPath = Join-Path $repositoryRoot $OutputDirectory
if (-not (Test-Path -LiteralPath $requestedPath)) {
  New-Item -ItemType Directory -Path $requestedPath | Out-Null
}
$resolvedPath = (Resolve-Path -LiteralPath $requestedPath).Path
if (-not $resolvedPath.StartsWith($repositoryRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Output directory must stay inside the repository: $resolvedPath"
}

$dockerfile = Join-Path $repositoryRoot 'infra/docker/Dockerfile.backup'
docker build --file $dockerfile --tag pharmacy-os-backup-keygen $repositoryRoot
if ($LASTEXITCODE -ne 0) { throw 'Backup image build failed' }

$dockerArguments = @(
  'run',
  '--rm',
  '--volume',
  "${resolvedPath}:/keys",
  'pharmacy-os-backup-keygen',
  'keygen',
  '/keys/backup-age-identity.txt',
  '/keys/backup-age-recipient.txt'
)
docker @dockerArguments
if ($LASTEXITCODE -ne 0) { throw 'Backup identity generation failed' }

Write-Output "Identity: $resolvedPath\backup-age-identity.txt"
Write-Output "Recipient: $resolvedPath\backup-age-recipient.txt"
