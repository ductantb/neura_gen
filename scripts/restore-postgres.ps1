[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$DumpFile,
  [string]$DatabaseUrl = $env:DATABASE_URL,
  [switch]$Force,
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

function Get-RedactedConnectionString {
  param([string]$Url)
  $uri = [System.Uri]$Url
  $userInfo = $uri.UserInfo
  $username = ""
  if (-not [string]::IsNullOrWhiteSpace($userInfo)) {
    $username = ($userInfo -split ":", 2)[0]
  }

  $db = $uri.AbsolutePath.Trim("/")
  return "$($uri.Scheme)://$username@$($uri.Host):$($uri.Port)/$db"
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

$null = Get-Command pg_restore -ErrorAction Stop
$null = Get-Command psql -ErrorAction Stop

$pgRestoreMajor = Get-ClientMajorVersion -CommandName "pg_restore"
$serverMajor = Get-ServerMajorVersion -Url $DatabaseUrl
if (-not $AllowVersionMismatch -and $pgRestoreMajor -ne $serverMajor) {
  throw "Version mismatch: pg_restore major=$pgRestoreMajor, server major=$serverMajor. Install matching pg_restore version or pass -AllowVersionMismatch."
}

$resolvedDumpFile = [System.IO.Path]::GetFullPath($DumpFile)
if (-not (Test-Path -LiteralPath $resolvedDumpFile -PathType Leaf)) {
  throw "Dump file not found: $resolvedDumpFile"
}

$dbName = Get-DbNameFromUrl -Url $DatabaseUrl
$targetInfo = Get-RedactedConnectionString -Url $DatabaseUrl

if (-not $Force) {
  throw "Restore is destructive. Re-run with -Force to proceed. Target: $targetInfo"
}

Write-Host "Restoring dump to $targetInfo from $resolvedDumpFile"

& pg_restore `
  --dbname "$DatabaseUrl" `
  --clean `
  --if-exists `
  --no-owner `
  --no-privileges `
  --exit-on-error `
  "$resolvedDumpFile"

if ($LASTEXITCODE -ne 0) {
  throw "pg_restore failed with exit code $LASTEXITCODE"
}

$probeSql = "SELECT 1;"
& psql "$DatabaseUrl" -v "ON_ERROR_STOP=1" -t -A -c $probeSql | Out-Null

if ($LASTEXITCODE -ne 0) {
  throw "Post-restore connectivity probe failed for database '$dbName'."
}

Write-Host "Restore completed successfully for database '$dbName'."
