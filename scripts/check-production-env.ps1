[CmdletBinding()]
param(
  [string]$EnvFile = ".env",
  [string[]]$RequiredKeys = @(
    "DATABASE_URL",
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "REDIS_URL",
    "VIDEO_QUEUE_NAME",
    "STORAGE_DRIVER",
    "AWS_REGION",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_S3_BUCKET",
    "MODAL_GENERATE_VIDEO_WAN_URL",
    "FRONTEND_URL",
    "GOOGLE_CALLBACK_URL",
    "OAUTH_ALLOWED_REDIRECT_URIS"
  )
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
  throw "Env file not found: $EnvFile"
}

$lines = Get-Content -LiteralPath $EnvFile
$map = @{}

foreach ($line in $lines) {
  if ($line -match '^\s*#') { continue }
  if ($line -match '^\s*$') { continue }
  if ($line -notmatch '^[A-Za-z_][A-Za-z0-9_]*=') { continue }

  $parts = $line -split '=', 2
  $key = $parts[0].Trim()
  $value = if ($parts.Count -gt 1) { $parts[1] } else { "" }
  $map[$key] = $value
}

$missing = @()
$empty = @()
foreach ($key in $RequiredKeys) {
  if (-not $map.ContainsKey($key)) {
    $missing += $key
    continue
  }

  $value = ($map[$key] -replace '^"|"$','').Trim()
  if ([string]::IsNullOrWhiteSpace($value)) {
    $empty += $key
  }
}

$localhostKeys = @()
foreach ($entry in $map.GetEnumerator()) {
  $val = ($entry.Value -replace '^"|"$','').Trim().ToLowerInvariant()
  if ($val.Contains("localhost") -or $val.Contains("127.0.0.1")) {
    $localhostKeys += $entry.Key
  }
}

Write-Host "=== Production env check ==="
Write-Host "File: $EnvFile"

if ($missing.Count -eq 0 -and $empty.Count -eq 0) {
  Write-Host "Required keys: OK"
} else {
  if ($missing.Count -gt 0) {
    Write-Host "Missing keys:" -ForegroundColor Yellow
    $missing | ForEach-Object { Write-Host " - $_" }
  }
  if ($empty.Count -gt 0) {
    Write-Host "Empty keys:" -ForegroundColor Yellow
    $empty | ForEach-Object { Write-Host " - $_" }
  }
}

if ($localhostKeys.Count -gt 0) {
  Write-Host "Localhost values found (replace for production):" -ForegroundColor Yellow
  $localhostKeys | Sort-Object -Unique | ForEach-Object { Write-Host " - $_" }
} else {
  Write-Host "No localhost values found."
}

if ($missing.Count -gt 0 -or $empty.Count -gt 0) {
  exit 2
}
