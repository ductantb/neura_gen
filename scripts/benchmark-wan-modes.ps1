param(
    [string]$ApiBaseUrl = "http://localhost:3000",
    [string]$Email = "test@gmail.com",
    [string]$Password = "12345678",
    [ValidateSet("Both", "I2V", "T2V")]
    [string]$Mode = "Both",
    [string]$PresetId = "standard_wan22_ti2v",
    [string]$ImagePath,
    [string]$PromptI2V = "A cinematic handheld shot with clear natural body motion and stable camera movement.",
    [string]$PromptT2V = "A cinematic medium shot of a traveler walking through light rain at night, natural motion, stable camera movement.",
    [string]$NegativePrompt = "blurry, low quality, distorted anatomy, flicker",
    [int]$PollIntervalSeconds = 10,
    [int]$TimeoutSeconds = 2400,
    [switch]$IncludeBackgroundAudio
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

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

function Get-Token {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BaseUrl,
        [Parameter(Mandatory = $true)]
        [string]$UserEmail,
        [Parameter(Mandatory = $true)]
        [string]$UserPassword
    )

    $loginResponse = Invoke-RestMethod `
        -Method Post `
        -Uri "$BaseUrl/auth/login" `
        -ContentType "application/json" `
        -Body (@{
            email = $UserEmail
            password = $UserPassword
        } | ConvertTo-Json)

    $loginData = Get-ApiData $loginResponse
    if (-not $loginData.accessToken) {
        throw "Login succeeded but accessToken is missing."
    }

    return [string]$loginData.accessToken
}

function Upload-InputAsset {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BaseUrl,
        [Parameter(Mandatory = $true)]
        [hashtable]$Headers,
        [Parameter(Mandatory = $true)]
        [string]$LocalImagePath
    )

    if (-not (Test-Path -LiteralPath $LocalImagePath)) {
        throw "Input image not found: $LocalImagePath"
    }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $uploadResponse = Invoke-RestMethod `
        -Method Post `
        -Uri "$BaseUrl/assets/upload" `
        -Headers $Headers `
        -Form @{
            file = Get-Item -LiteralPath $LocalImagePath
            role = "INPUT"
            type = "IMAGE"
        }
    $sw.Stop()

    $uploadData = Get-ApiData $uploadResponse
    if (-not $uploadData.id) {
        throw "Upload succeeded but input asset id is missing."
    }

    return @{
        assetId = [string]$uploadData.id
        uploadSeconds = [Math]::Round($sw.Elapsed.TotalSeconds, 2)
    }
}

function Create-VideoJob {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BaseUrl,
        [Parameter(Mandatory = $true)]
        [hashtable]$Headers,
        [Parameter(Mandatory = $true)]
        [string]$Prompt,
        [Parameter(Mandatory = $true)]
        [string]$Preset,
        [string]$NegPrompt,
        [string]$InputAssetId,
        [bool]$EnableBackgroundAudio
    )

    $body = @{
        prompt = $Prompt
        presetId = $Preset
        includeBackgroundAudio = $EnableBackgroundAudio
    }
    if ($NegPrompt) {
        $body.negativePrompt = $NegPrompt
    }
    if ($InputAssetId) {
        $body.inputAssetId = $InputAssetId
    }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $jobResponse = Invoke-RestMethod `
        -Method Post `
        -Uri "$BaseUrl/jobs/video" `
        -Headers $Headers `
        -ContentType "application/json" `
        -Body ($body | ConvertTo-Json)
    $sw.Stop()

    $jobData = Get-ApiData $jobResponse
    if (-not $jobData.jobId) {
        throw "Job creation succeeded but jobId is missing."
    }

    return @{
        jobData = $jobData
        jobCreateSeconds = [Math]::Round($sw.Elapsed.TotalSeconds, 2)
    }
}

function Wait-JobResult {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BaseUrl,
        [Parameter(Mandatory = $true)]
        [hashtable]$Headers,
        [Parameter(Mandatory = $true)]
        [string]$JobId,
        [Parameter(Mandatory = $true)]
        [int]$PollSeconds,
        [Parameter(Mandatory = $true)]
        [int]$MaxSeconds
    )

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($true) {
        if ($sw.Elapsed.TotalSeconds -ge $MaxSeconds) {
            throw "Timed out after $MaxSeconds seconds while waiting for job $JobId."
        }

        $resultResponse = Invoke-RestMethod `
            -Method Get `
            -Uri "$BaseUrl/jobs/$JobId/result" `
            -Headers $Headers
        $resultData = Get-ApiData $resultResponse

        $status = [string]$resultData.status
        $progress = $resultData.progress
        Write-Host ("[{0,5:n0}s] job={1} status={2} progress={3}" -f $sw.Elapsed.TotalSeconds, $JobId, $status, $progress)

        if ($status -eq "COMPLETED") {
            $sw.Stop()
            return @{
                resultData = $resultData
                waitSeconds = [Math]::Round($sw.Elapsed.TotalSeconds, 2)
            }
        }

        if ($status -in @("FAILED", "CANCELLED")) {
            throw "Job $JobId failed with status $status. Response: $($resultData | ConvertTo-Json -Depth 8 -Compress)"
        }

        Start-Sleep -Seconds $PollSeconds
    }
}

function Get-JobDetails {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BaseUrl,
        [Parameter(Mandatory = $true)]
        [hashtable]$Headers,
        [Parameter(Mandatory = $true)]
        [string]$JobId
    )

    $detailsResponse = Invoke-RestMethod `
        -Method Get `
        -Uri "$BaseUrl/jobs/$JobId" `
        -Headers $Headers

    return Get-ApiData $detailsResponse
}

function Parse-IsoTime {
    param([string]$Value)
    if (-not $Value) {
        return $null
    }
    return [DateTimeOffset]::Parse($Value)
}

function Build-TimingSummary {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CaseName,
        [Parameter(Mandatory = $true)]
        $JobData,
        [Parameter(Mandatory = $true)]
        [double]$JobCreateSeconds,
        [Parameter(Mandatory = $true)]
        [double]$PollWaitSeconds,
        [double]$UploadSeconds = 0
    )

    $createdAt = Parse-IsoTime -Value $JobData.createdAt
    $startedAt = Parse-IsoTime -Value $JobData.startedAt
    $completedAt = Parse-IsoTime -Value $JobData.completedAt

    $queueSeconds = $null
    if ($createdAt -and $startedAt) {
        $queueSeconds = [Math]::Round(($startedAt - $createdAt).TotalSeconds, 2)
    }

    $processingSeconds = $null
    if ($startedAt -and $completedAt) {
        $processingSeconds = [Math]::Round(($completedAt - $startedAt).TotalSeconds, 2)
    }

    $jobTotalSeconds = $null
    if ($createdAt -and $completedAt) {
        $jobTotalSeconds = [Math]::Round(($completedAt - $createdAt).TotalSeconds, 2)
    }

    return [PSCustomObject]@{
        case = $CaseName
        jobId = [string]$JobData.id
        status = [string]$JobData.status
        presetId = [string]$JobData.presetId
        workflow = [string]$JobData.workflow
        modelName = [string]$JobData.modelName
        uploadSeconds = $UploadSeconds
        createJobSeconds = $JobCreateSeconds
        pollWaitSeconds = $PollWaitSeconds
        queueSeconds = $queueSeconds
        processingSeconds = $processingSeconds
        jobTotalSeconds = $jobTotalSeconds
        includeBackgroundAudio = [bool]$JobData.includeBackgroundAudio
    }
}

function Run-BenchmarkCase {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CaseName,
        [Parameter(Mandatory = $true)]
        [bool]$NeedsImage,
        [Parameter(Mandatory = $true)]
        [string]$Prompt,
        [Parameter(Mandatory = $true)]
        [string]$BaseUrl,
        [Parameter(Mandatory = $true)]
        [hashtable]$Headers,
        [Parameter(Mandatory = $true)]
        [string]$Preset,
        [string]$NegPrompt,
        [string]$LocalImagePath,
        [int]$PollSeconds = 10,
        [int]$MaxSeconds = 2400,
        [bool]$EnableBackgroundAudio = $false
    )

    Write-Host ""
    Write-Host "=== $CaseName ==="

    $inputAssetId = $null
    $uploadSeconds = 0.0
    if ($NeedsImage) {
        if (-not $LocalImagePath) {
            throw "ImagePath is required for case $CaseName."
        }
        Write-Host "[1/4] Uploading input image..."
        $upload = Upload-InputAsset -BaseUrl $BaseUrl -Headers $Headers -LocalImagePath $LocalImagePath
        $inputAssetId = $upload.assetId
        $uploadSeconds = $upload.uploadSeconds
        Write-Host ("Uploaded assetId={0} ({1}s)" -f $inputAssetId, $uploadSeconds)
    } else {
        Write-Host "[1/4] Skipping upload (text-only mode)."
    }

    Write-Host "[2/4] Creating job..."
    $created = Create-VideoJob `
        -BaseUrl $BaseUrl `
        -Headers $Headers `
        -Prompt $Prompt `
        -Preset $Preset `
        -NegPrompt $NegPrompt `
        -InputAssetId $inputAssetId `
        -EnableBackgroundAudio:$EnableBackgroundAudio

    $jobId = [string]$created.jobData.jobId
    Write-Host ("Job created: {0} (create={1}s)" -f $jobId, $created.jobCreateSeconds)

    Write-Host "[3/4] Polling result..."
    $waited = Wait-JobResult `
        -BaseUrl $BaseUrl `
        -Headers $Headers `
        -JobId $jobId `
        -PollSeconds $PollSeconds `
        -MaxSeconds $MaxSeconds
    Write-Host ("Completed in poll wait: {0}s" -f $waited.waitSeconds)

    Write-Host "[4/4] Fetching job details..."
    $jobDetails = Get-JobDetails -BaseUrl $BaseUrl -Headers $Headers -JobId $jobId

    $summary = Build-TimingSummary `
        -CaseName $CaseName `
        -JobData $jobDetails `
        -JobCreateSeconds $created.jobCreateSeconds `
        -PollWaitSeconds $waited.waitSeconds `
        -UploadSeconds $uploadSeconds

    Write-Host ("Summary: workflow={0} queue={1}s processing={2}s total={3}s" -f `
            $summary.workflow, $summary.queueSeconds, $summary.processingSeconds, $summary.jobTotalSeconds)

    return $summary
}

if (($Mode -eq "I2V" -or $Mode -eq "Both") -and -not $ImagePath) {
    throw "ImagePath is required when Mode is I2V or Both."
}

Write-Host ("Logging in to {0} as {1}..." -f $ApiBaseUrl, $Email)
$token = Get-Token -BaseUrl $ApiBaseUrl -UserEmail $Email -UserPassword $Password
$headers = @{
    Authorization = "Bearer $token"
}
Write-Host "Login OK."

$results = New-Object System.Collections.Generic.List[object]

if ($Mode -eq "I2V" -or $Mode -eq "Both") {
    $results.Add(
        (Run-BenchmarkCase `
            -CaseName "WAN TI2V (I2V with input image)" `
            -NeedsImage $true `
            -Prompt $PromptI2V `
            -BaseUrl $ApiBaseUrl `
            -Headers $headers `
            -Preset $PresetId `
            -NegPrompt $NegativePrompt `
            -LocalImagePath $ImagePath `
            -PollSeconds $PollIntervalSeconds `
            -MaxSeconds $TimeoutSeconds `
            -EnableBackgroundAudio:$IncludeBackgroundAudio.IsPresent)
    )
}

if ($Mode -eq "T2V" -or $Mode -eq "Both") {
    $results.Add(
        (Run-BenchmarkCase `
            -CaseName "WAN TI2V (T2V text-only)" `
            -NeedsImage $false `
            -Prompt $PromptT2V `
            -BaseUrl $ApiBaseUrl `
            -Headers $headers `
            -Preset $PresetId `
            -NegPrompt $NegativePrompt `
            -PollSeconds $PollIntervalSeconds `
            -MaxSeconds $TimeoutSeconds `
            -EnableBackgroundAudio:$IncludeBackgroundAudio.IsPresent)
    )
}

Write-Host ""
Write-Host "=== Benchmark Result Table ==="
$results | Format-Table -AutoSize

Write-Host ""
Write-Host "=== Benchmark Result JSON ==="
$results | ConvertTo-Json -Depth 6
