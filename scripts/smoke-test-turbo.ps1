param(
    [string]$ApiBaseUrl = "http://localhost:3000",
    [string]$Email = "test@gmail.com",
    [string]$Password = "12345678",
    [Parameter(Mandatory = $true)]
    [string]$ImagePath,
    [string]$Prompt = "A cinematic handheld shot with clear natural body motion and stable camera movement.",
    [string]$NegativePrompt = "blurry, low quality, distorted anatomy, flicker",
    [int]$PollIntervalSeconds = 10,
    [int]$TimeoutSeconds = 2400
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ImagePath)) {
    throw "Input image not found: $ImagePath"
}

function Get-ApiData {
    param(
        [Parameter(Mandatory = $true)]
        $Response
    )

    if ($null -eq $Response) {
        throw "API returned null response."
    }

    if ($Response.PSObject.Properties.Name -contains "data") {
        return $Response.data
    }

    return $Response
}

Write-Host "[1/4] Logging in to $ApiBaseUrl ..."
$loginResponse = Invoke-RestMethod `
    -Method Post `
    -Uri "$ApiBaseUrl/auth/login" `
    -ContentType "application/json" `
    -Body (@{
        email = $Email
        password = $Password
    } | ConvertTo-Json)

$loginData = Get-ApiData $loginResponse
$accessToken = $loginData.accessToken

if (-not $accessToken) {
    throw "Login succeeded but accessToken is missing."
}

$headers = @{
    Authorization = "Bearer $accessToken"
}

Write-Host "[2/4] Uploading input image ..."
$uploadResponse = Invoke-RestMethod `
    -Method Post `
    -Uri "$ApiBaseUrl/assets/upload" `
    -Headers $headers `
    -Form @{
        file = Get-Item -LiteralPath $ImagePath
        role = "INPUT"
        type = "IMAGE"
    }

$uploadData = Get-ApiData $uploadResponse
$inputAssetId = $uploadData.id

if (-not $inputAssetId) {
    throw "Upload succeeded but input asset id is missing."
}

Write-Host "[3/4] Creating turbo video job ..."
$jobResponse = Invoke-RestMethod `
    -Method Post `
    -Uri "$ApiBaseUrl/jobs/video" `
    -Headers $headers `
    -ContentType "application/json" `
    -Body (@{
        inputAssetId = $inputAssetId
        prompt = $Prompt
        negativePrompt = $NegativePrompt
        presetId = "turbo_wan22_i2v_a14b"
    } | ConvertTo-Json)

$jobData = Get-ApiData $jobResponse
$jobId = $jobData.jobId

if (-not $jobId) {
    throw "Job creation succeeded but jobId is missing."
}

Write-Host "Job created: $jobId"
Write-Host "[4/4] Polling job result ..."

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

while ($true) {
    if ($stopwatch.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
        throw "Timed out after $TimeoutSeconds seconds while waiting for job $jobId."
    }

    $resultResponse = Invoke-RestMethod `
        -Method Get `
        -Uri "$ApiBaseUrl/jobs/$jobId/result" `
        -Headers $headers

    $resultData = Get-ApiData $resultResponse
    $status = $resultData.status
    $progress = $resultData.progress

    Write-Host ("[{0,5:n0}s] status={1} progress={2}" -f $stopwatch.Elapsed.TotalSeconds, $status, $progress)

    if ($status -eq "COMPLETED") {
        Write-Host ""
        Write-Host "Turbo smoke test passed."
        $resultData | ConvertTo-Json -Depth 8
        exit 0
    }

    if ($status -in @("FAILED", "CANCELLED")) {
        throw "Turbo smoke test failed for job $jobId with status $status. Response: $($resultData | ConvertTo-Json -Depth 8 -Compress)"
    }

    Start-Sleep -Seconds $PollIntervalSeconds
}
