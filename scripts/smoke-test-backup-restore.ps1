[CmdletBinding()]
param(
  [string]$ContainerName = "neura_gen_backup_smoke_db",
  [int]$Port = 55432,
  [string]$PostgresImage = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$backupScript = Join-Path $PSScriptRoot "backup-postgres.ps1"
$restoreScript = Join-Path $PSScriptRoot "restore-postgres.ps1"
$tmpDir = Join-Path $repoRoot "tmp/backup-smoke"
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

if ([string]::IsNullOrWhiteSpace($PostgresImage)) {
  $pgDumpVersion = (& pg_dump --version).Trim()
  if ($pgDumpVersion -notmatch "(\d+)(\.\d+)?") {
    throw "Cannot parse local pg_dump version from '$pgDumpVersion'."
  }
  $clientMajor = [int]$Matches[1]
  $PostgresImage = "postgres:$clientMajor"
}

$dbUser = "smoke_user"
$dbPassword = "smoke_password"
$dbName = "smoke_db"
$dbUrl = "postgresql://${dbUser}:${dbPassword}@localhost:${Port}/${dbName}"

function Cleanup {
  docker rm -f $ContainerName *> $null
}

try {
  Cleanup
} catch {
}

try {
  Write-Host "Starting disposable PostgreSQL container..."
  docker run --name $ContainerName --rm -d `
    -e "POSTGRES_USER=$dbUser" `
    -e "POSTGRES_PASSWORD=$dbPassword" `
    -e "POSTGRES_DB=$dbName" `
    -p "${Port}:5432" `
    $PostgresImage | Out-Null

  $maxAttempts = 60
  for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    try {
      $ready = docker exec $ContainerName pg_isready -U $dbUser -d $dbName 2>$null
      if ($ready -match "accepting connections") {
        break
      }
    } catch {
    }
    Start-Sleep -Seconds 1
  }

  $readyCheck = docker exec $ContainerName pg_isready -U $dbUser -d $dbName
  if (-not ($readyCheck -match "accepting connections")) {
    throw "PostgreSQL container did not become ready in time."
  }

  Write-Host "Preparing sample data..."
  & psql "$dbUrl" -v "ON_ERROR_STOP=1" -c "CREATE TABLE smoke_items (id serial primary key, name text not null);"
  & psql "$dbUrl" -v "ON_ERROR_STOP=1" -c "INSERT INTO smoke_items (name) VALUES ('alpha'), ('beta');"

  Write-Host "Running backup script..."
  & pwsh -File $backupScript -DatabaseUrl $dbUrl -OutputDir $tmpDir -RetentionDays -1 -Label "smoke-test"
  if ($LASTEXITCODE -ne 0) {
    throw "Backup script failed."
  }

  $latestDump = Get-ChildItem -Path $tmpDir -Filter "*.dump" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if (-not $latestDump) {
    throw "No dump file created by backup script."
  }

  Write-Host "Mutating database state before restore..."
  & psql "$dbUrl" -v "ON_ERROR_STOP=1" -c "TRUNCATE TABLE smoke_items;"

  $countAfterTruncate = (& psql "$dbUrl" -t -A -v "ON_ERROR_STOP=1" -c "SELECT COUNT(*) FROM smoke_items;").Trim()
  if ($countAfterTruncate -ne "0") {
    throw "Expected truncated row count = 0, got $countAfterTruncate"
  }

  Write-Host "Running restore script..."
  & pwsh -File $restoreScript -DatabaseUrl $dbUrl -DumpFile $latestDump.FullName -Force
  if ($LASTEXITCODE -ne 0) {
    throw "Restore script failed."
  }

  $countAfterRestore = (& psql "$dbUrl" -t -A -v "ON_ERROR_STOP=1" -c "SELECT COUNT(*) FROM smoke_items;").Trim()
  if ($countAfterRestore -ne "2") {
    throw "Expected restored row count = 2, got $countAfterRestore"
  }

  Write-Host "Smoke test passed. Backup/restore flow is working."
} finally {
  Cleanup
}
