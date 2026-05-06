[CmdletBinding()]
param(
  [string]$ApiService = "api",
  [string]$WorkerService = "worker",
  [string]$EnvFile = ".env",
  [switch]$SkipEnvSync
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command railway -ErrorAction SilentlyContinue)) {
  throw "Railway CLI not found. Install via: npm install -g @railway/cli"
}

railway whoami | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Railway CLI is not authenticated. Run: railway login"
}

if (-not $SkipEnvSync) {
  Write-Host "Syncing env to API service..."
  pwsh -File scripts/railway-sync-env.ps1 -Service $ApiService -EnvFile $EnvFile -SkipDeploys

  Write-Host "Syncing env to Worker service..."
  pwsh -File scripts/railway-sync-env.ps1 -Service $WorkerService -EnvFile $EnvFile -SkipDeploys
}

Write-Host "Setting RUN_WORKER flags..."
"false" | railway variable set --service $ApiService --stdin --skip-deploys RUN_WORKER | Out-Null
"true" | railway variable set --service $WorkerService --stdin --skip-deploys RUN_WORKER | Out-Null

Write-Host "Deploying API..."
railway up --service $ApiService --detach
if ($LASTEXITCODE -ne 0) {
  throw "API deploy failed"
}

Write-Host "Deploying Worker..."
railway up --service $WorkerService --detach
if ($LASTEXITCODE -ne 0) {
  throw "Worker deploy failed"
}

Write-Host "Done. Deployments triggered for '$ApiService' and '$WorkerService'."
