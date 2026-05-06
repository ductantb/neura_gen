[CmdletBinding()]
param(
  [string]$DatabaseUrl = $env:DATABASE_URL,
  [string]$OutputDir = "backups/postgres",
  [int]$RetentionDays = 14,
  [string]$Label = "",
  [switch]$AllowVersionMismatch
)

$ErrorActionPreference = "Stop"

function Get-DbNameFromUrl {
  param([string]$Url)
  $uri = [System.Uri]$Url
  $dbName = $uri.AbsolutePath.Trim("/")
  if ([string]::IsNullOrWhiteSpace($dbName)) {
    throw "DATABASE_URL does not include database name."
  }
  return $dbName
}

function Get-SafeLabel {
  param([string]$Raw)
  if ([string]::IsNullOrWhiteSpace($Raw)) {
    return ""
  }
  $sanitized = $Raw -replace "[^a-zA-Z0-9_-]", "-"
  return "-$sanitized"
}

function Get-RedactedConnectionInfo {
  param([string]$Url)
  $uri = [System.Uri]$Url
  $userInfo = $uri.UserInfo
  $username = ""
  if (-not [string]::IsNullOrWhiteSpace($userInfo)) {
    $username = ($userInfo -split ":", 2)[0]
  }

  return @{
    scheme = $uri.Scheme
    host = $uri.Host
    port = $uri.Port
    database = $uri.AbsolutePath.Trim("/")
    username = $username
  }
}

function Get-ClientMajorVersion {
  param([string]$CommandName)
  $versionText = (& $CommandName --version).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to read version from '$CommandName'."
  }
  if ($versionText -notmatch "(\d+)(\.\d+)?") {
    throw "Cannot parse version from '$versionText'."
  }
  return [int]$Matches[1]
}

function Get-ServerMajorVersion {
  param([string]$Url)
  $serverVersionNum = (& psql "$Url" -t -A -v "ON_ERROR_STOP=1" -c "SHOW server_version_num;").Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to query PostgreSQL server version."
  }
  if ($serverVersionNum -notmatch "^\d{5,6}$") {
    throw "Unexpected server_version_num: '$serverVersionNum'"
  }
  return [int]$serverVersionNum.Substring(0, $serverVersionNum.Length - 4)
}

if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
  throw "Missing DATABASE_URL. Pass -DatabaseUrl or set DATABASE_URL in environment."
}

$null = Get-Command pg_dump -ErrorAction Stop
$null = Get-Command psql -ErrorAction Stop

$pgDumpMajor = Get-ClientMajorVersion -CommandName "pg_dump"
$serverMajor = Get-ServerMajorVersion -Url $DatabaseUrl
if (-not $AllowVersionMismatch -and $pgDumpMajor -ne $serverMajor) {
  throw "Version mismatch: pg_dump major=$pgDumpMajor, server major=$serverMajor. Install matching pg_dump version or pass -AllowVersionMismatch."
}

$resolvedOutputDir = [System.IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Path $resolvedOutputDir -Force | Out-Null

$dbName = Get-DbNameFromUrl -Url $DatabaseUrl
$safeLabel = Get-SafeLabel -Raw $Label
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
$baseName = "$timestamp-$dbName$safeLabel"

$dumpPath = Join-Path $resolvedOutputDir "$baseName.dump"
$shaPath = Join-Path $resolvedOutputDir "$baseName.sha256"
$metaPath = Join-Path $resolvedOutputDir "$baseName.json"

Write-Host "Creating backup: $dumpPath"

& pg_dump `
  --dbname "$DatabaseUrl" `
  --format=custom `
  --no-owner `
  --no-privileges `
  --file "$dumpPath"

if ($LASTEXITCODE -ne 0) {
  throw "pg_dump failed with exit code $LASTEXITCODE"
}

$hash = (Get-FileHash -Path $dumpPath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -Path $shaPath -Value "$hash *$([System.IO.Path]::GetFileName($dumpPath))"

$metadata = @{
  createdAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  database = Get-RedactedConnectionInfo -Url $DatabaseUrl
  dumpFile = [System.IO.Path]::GetFileName($dumpPath)
  sha256 = $hash
  sizeBytes = (Get-Item $dumpPath).Length
  tool = "pg_dump custom format"
}

$metadata | ConvertTo-Json -Depth 5 | Set-Content -Path $metaPath

if ($RetentionDays -ge 0) {
  $cutoff = (Get-Date).AddDays(-$RetentionDays)
  Get-ChildItem -Path $resolvedOutputDir -File |
    Where-Object {
      $_.LastWriteTime -lt $cutoff -and
      ($_.Extension -in @(".dump", ".sha256", ".json"))
    } |
    Remove-Item -Force
}

Write-Host "Backup created successfully."
Write-Host "Dump: $dumpPath"
Write-Host "SHA : $shaPath"
Write-Host "Meta: $metaPath"
