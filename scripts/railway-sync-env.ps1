[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Service,
  [string]$EnvFile = ".env",
  [switch]$SkipDeploys,
  [string[]]$ExcludeKeys = @(
    "PORT"
  )
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command railway -ErrorAction SilentlyContinue)) {
  throw "Railway CLI not found. Install via: npm install -g @railway/cli"
}

if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
  throw "Env file not found: $EnvFile"
}

$who = railway whoami 2>$null
if ($LASTEXITCODE -ne 0) {
  throw "Railway CLI is not authenticated. Run: railway login"
}

$lines = Get-Content -LiteralPath $EnvFile
$pairs = @{}

foreach ($line in $lines) {
  if ($line -match '^\s*#') { continue }
  if ($line -match '^\s*$') { continue }
  if ($line -notmatch '^[A-Za-z_][A-Za-z0-9_]*=') { continue }

  $parts = $line -split '=', 2
  $key = $parts[0].Trim()
  if ($ExcludeKeys -contains $key) { continue }

  $value = if ($parts.Count -gt 1) { $parts[1] } else { "" }
  $value = $value.Trim()
  if ($value.StartsWith('"') -and $value.EndsWith('"') -and $value.Length -ge 2) {
    $value = $value.Substring(1, $value.Length - 2)
  }

  $pairs[$key] = $value
}

if ($pairs.Count -eq 0) {
  throw "No variables parsed from $EnvFile"
}

foreach ($entry in $pairs.GetEnumerator()) {
  $key = $entry.Key
  $value = [string]$entry.Value

  if ($value.Length -eq 0) {
    Write-Host "Skip $key (empty value)"
    continue
  }

  if ($SkipDeploys) {
    $value | railway variable set --service $Service --stdin --skip-deploys $key | Out-Null
  } else {
    $value | railway variable set --service $Service --stdin $key | Out-Null
  }

  if ($LASTEXITCODE -ne 0) {
    throw "Failed setting variable '$key' for service '$Service'"
  }

  Write-Host "Set $key"
}

Write-Host "Done syncing variables to service '$Service'."
