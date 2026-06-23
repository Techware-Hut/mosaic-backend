# Vendor approval progression E2E proof - sanitized output only.
# Requires session env vars (never commit values):
#   SMOKE_TEST_ADMIN_TOKEN
#   SMOKE_TEST_VENDOR_TOKEN
# Optional:
#   API_BASE_URL (default https://api.mosaicbizhub.com)
#   TEST_APPLICATION_ID - target submitted app for admin flow (sanitized id only in logs)

param(
    [string]$ApiBaseUrl = $(if ($env:API_BASE_URL) { $env:API_BASE_URL } else { "https://api.mosaicbizhub.com" }),
    [string]$AdminToken = $env:SMOKE_TEST_ADMIN_TOKEN,
    [string]$VendorToken = $env:SMOKE_TEST_VENDOR_TOKEN,
    [string]$TestApplicationId = $env:TEST_APPLICATION_ID
)

$ErrorActionPreference = 'Stop'
$Base = $ApiBaseUrl.TrimEnd('/')
$Results = @()

function Add-Result($route, $action, $expected, $actual, $statusCode, $owner, $severity) {
    $script:Results += [pscustomobject]@{
        route      = $route
        action     = $action
        expected   = $expected
        actual     = $actual
        statusCode = $statusCode
        owner      = $owner
        severity   = $severity
    }
}

function Invoke-Api($Method, $Path, $Token = $null, $Body = $null) {
    $headers = @{ Accept = 'application/json' }
    if ($Token) { $headers.Authorization = "Bearer $Token" }
    try {
        $params = @{
            Uri             = "$Base$Path"
            Method          = $Method
            Headers         = $headers
            UseBasicParsing = $true
            ErrorAction     = 'Stop'
        }
        if ($Body) {
            $params.Body = ($Body | ConvertTo-Json -Compress)
            $params.ContentType = 'application/json'
        }
        $r = Invoke-WebRequest @params
        $parsed = $null
        if ($r.Content) {
            try { $parsed = $r.Content | ConvertFrom-Json } catch { $parsed = $r.Content }
        }
        return @{ statusCode = [int]$r.StatusCode; body = $parsed; error = $null }
    } catch {
        if ($_.Exception.Response) {
            $resp = $_.Exception.Response
            $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
            $content = $reader.ReadToEnd()
            $reader.Close()
            $parsed = $null
            if ($content) {
                try { $parsed = $content | ConvertFrom-Json } catch { $parsed = $content }
            }
            return @{
                statusCode = [int]$resp.StatusCode.value__
                body       = $parsed
                error      = $null
            }
        }
        return @{ statusCode = 0; body = $null; error = $_.Exception.Message }
    }
}

function Sanitize-OnboardingStatus($body) {
    if (-not $body) { return '(empty)' }
    $parts = @()
    if ($body.data.status) { $parts += "status=$($body.data.status)" }
    if ($body.data.verificationPayment.status) { $parts += "payment=$($body.data.verificationPayment.status)" }
    if ($body.data.canSubmit -ne $null) { $parts += "canSubmit=$($body.data.canSubmit)" }
    if ($body.applicationId) { $parts += "applicationId=$($body.applicationId)" }
    if ($body.data.applicationId) { $parts += "applicationId=$($body.data.applicationId)" }
    if ($body.data -is [array]) { $parts += "count=$($body.data.Count)" }
    if ($body.data.status -eq 'approved') { $parts += 'finalizeResponse=approved' }
    if ($parts.Count -eq 0) { return 'success payload (fields redacted)' }
    return ($parts -join ', ')
}

Write-Host "=== Vendor Approval Progression E2E Proof ==="
Write-Host "API=$Base"
Write-Host ""

# Route guard probes (no auth)
$guardRoutes = @(
    @{ m = 'GET'; p = '/api/vendor-onboarding/pending'; n = 'admin pending' },
    @{ m = 'POST'; p = '/api/vendor-onboarding/submit'; n = 'vendor submit' },
    @{ m = 'PUT'; p = '/api/vendor-onboarding/business-profile'; n = 'business profile' },
    @{ m = 'GET'; p = '/api/vendor-onboarding/stage1/payment-status'; n = 'payment status' }
)
foreach ($g in $guardRoutes) {
    $r = Invoke-Api -Method $g.m -Path $g.p
    $pass = ($r.statusCode -eq 401)
    Add-Result $g.p "unauth guard ($($g.n))" '401 Unauthorized' "HTTP $($r.statusCode)" $r.statusCode 'backend' $(if ($pass) { 'P2' } else { 'P0' })
    Write-Host "$(if ($pass) { 'PASS' } else { 'FAIL' })  $($g.m) $($g.p) unauth -> $($r.statusCode)"
}

if (-not $AdminToken) {
    Add-Result '/api/vendor-onboarding/pending' 'admin credentialed flow' '200 with submitted apps' 'BLOCKED: SMOKE_TEST_ADMIN_TOKEN unset' 0 'env' 'deferred'
    Write-Host "BLOCKED  Admin flow - SMOKE_TEST_ADMIN_TOKEN not set"
} else {
    $pending = Invoke-Api -Method 'GET' -Path '/api/vendor-onboarding/pending' -Token $AdminToken
    $pendingOk = ($pending.statusCode -eq 200 -and $pending.body.success -eq $true)
    Add-Result '/api/vendor-onboarding/pending' 'list submitted queue' '200 success' (Sanitize-OnboardingStatus $pending.body) $pending.statusCode 'backend' $(if ($pendingOk) { 'P2' } else { 'P0' })
    Write-Host "$(if ($pendingOk) { 'PASS' } else { 'FAIL' })  GET pending -> $($pending.statusCode) $(Sanitize-OnboardingStatus $pending.body)"

    $appId = $TestApplicationId
    if (-not $appId -and $pending.body.data -and $pending.body.data.Count -gt 0) {
        $appId = $pending.body.data[0].applicationId
    }

    if ($appId) {
        $detail = Invoke-Api -Method 'GET' -Path "/api/vendor-onboarding/$appId" -Token $AdminToken
        $detailOk = ($detail.statusCode -eq 200 -and $detail.body.data.status -eq 'submitted')
        Add-Result "/api/vendor-onboarding/$appId" 'admin detail' '200 status=submitted' (Sanitize-OnboardingStatus $detail.body) $detail.statusCode 'backend' $(if ($detailOk) { 'P2' } else { 'P1' })
        Write-Host "$(if ($detailOk) { 'PASS' } else { 'FAIL' })  GET detail $appId -> $($detail.statusCode) $(Sanitize-OnboardingStatus $detail.body)"

        $verify = Invoke-Api -Method 'POST' -Path "/api/vendor-onboarding/$appId/verify" -Token $AdminToken -Body @{
            verificationType = 'tax-doc'
            isVerified       = $true
        }
        $verifyOk = ($verify.statusCode -eq 200 -and $verify.body.success -eq $true)
        Add-Result "/api/vendor-onboarding/$appId/verify" 'checklist update' '200 checklist updated' (Sanitize-OnboardingStatus $verify.body) $verify.statusCode 'backend' $(if ($verifyOk) { 'P2' } else { 'P0' })
        Write-Host "$(if ($verifyOk) { 'PASS' } else { 'FAIL' })  POST verify -> $($verify.statusCode)"

        $beforeStatus = $detail.body.data.status
        $finalize = Invoke-Api -Method 'POST' -Path "/api/vendor-onboarding/$appId/finalize" -Token $AdminToken
        $finalizeOk = ($finalize.statusCode -eq 200 -and $finalize.body.data.status -eq 'approved')
        Add-Result "/api/vendor-onboarding/$appId/finalize" 'finalize approval' '200 data.status=approved' (Sanitize-OnboardingStatus $finalize.body) $finalize.statusCode 'backend' $(if ($finalizeOk) { 'P2' } else { 'P0' })
        Write-Host "$(if ($finalizeOk) { 'PASS' } else { 'FAIL' })  POST finalize -> $($finalize.statusCode) $(Sanitize-OnboardingStatus $finalize.body)"

        $detailAfter = Invoke-Api -Method 'GET' -Path "/api/vendor-onboarding/$appId" -Token $AdminToken
        $verifiedOk = ($detailAfter.statusCode -eq 200 -and $detailAfter.body.data.status -eq 'verified')
        Add-Result "/api/vendor-onboarding/$appId" 'post-finalize DB status' 'status=verified' "status=$($detailAfter.body.data.status)" $detailAfter.statusCode 'backend' $(if ($verifiedOk) { 'P2' } else { 'P0' })
        Write-Host "$(if ($verifiedOk) { 'PASS' } else { 'FAIL' })  GET detail after finalize -> status=$($detailAfter.body.data.status)"

        $pendingAfter = Invoke-Api -Method 'GET' -Path '/api/vendor-onboarding/pending' -Token $AdminToken
        $stillPending = $false
        if ($pendingAfter.body.data) {
            foreach ($item in $pendingAfter.body.data) {
                if ($item.applicationId -eq $appId) { $stillPending = $true; break }
            }
        }
        $removedOk = (-not $stillPending)
        Add-Result '/api/vendor-onboarding/pending' 'queue after approval' 'app absent' $(if ($removedOk) { 'absent' } else { 'still listed' }) $pendingAfter.statusCode 'backend' $(if ($removedOk) { 'P2' } else { 'P0' })
        Write-Host "$(if ($removedOk) { 'PASS' } else { 'FAIL' })  pending queue after finalize"
    } else {
        Add-Result '/api/vendor-onboarding/pending' 'admin detail/verify/finalize' 'submitted app available' 'BLOCKED: no submitted application in queue' 0 'data-state' 'deferred'
        Write-Host "BLOCKED  No submitted application in pending queue"
    }
}

if (-not $VendorToken) {
    Add-Result '/api/vendor-onboarding/business-profile' 'verified vendor profile unlock' '200 on PUT' 'BLOCKED: SMOKE_TEST_VENDOR_TOKEN unset' 0 'env' 'deferred'
    Add-Result '/api/business/my' 'business record' '200 with business payload' 'BLOCKED: SMOKE_TEST_VENDOR_TOKEN unset' 0 'env' 'deferred'
    Write-Host "BLOCKED  Vendor profile flow - SMOKE_TEST_VENDOR_TOKEN not set"
} else {
    $payStatus = Invoke-Api -Method 'GET' -Path '/api/vendor-onboarding/stage1/payment-status' -Token $VendorToken
    Add-Result '/api/vendor-onboarding/stage1/payment-status' 'payment poll' '200 sanitized payment fields' (Sanitize-OnboardingStatus $payStatus.body) $payStatus.statusCode 'backend' 'P2'
    Write-Host "INFO  payment-status -> $($payStatus.statusCode) $(Sanitize-OnboardingStatus $payStatus.body)"

    $onboarding = Invoke-Api -Method 'GET' -Path '/api/vendor-onboarding/onboarding-data' -Token $VendorToken
    Add-Result '/api/vendor-onboarding/onboarding-data' 'vendor onboarding state' '200 or 404' (Sanitize-OnboardingStatus $onboarding.body) $onboarding.statusCode 'backend' 'P2'
    Write-Host "INFO  onboarding-data -> $($onboarding.statusCode) $(Sanitize-OnboardingStatus $onboarding.body)"

    $profileBody = @{ businessBio = 'E2E proof profile update (sanitized test marker)' }
    $profile = Invoke-Api -Method 'PUT' -Path '/api/vendor-onboarding/business-profile' -Token $VendorToken -Body $profileBody
    $profileOk = ($profile.statusCode -eq 200)
    Add-Result '/api/vendor-onboarding/business-profile' 'PUT profile (verified gate)' '200 not 403' "HTTP $($profile.statusCode)" $profile.statusCode 'backend' $(if ($profileOk) { 'P2' } else { if ($profile.statusCode -eq 403) { 'P0' } else { 'P1' } })
    Write-Host "$(if ($profileOk) { 'PASS' } else { 'FAIL' })  PUT business-profile -> $($profile.statusCode)"

    $myBusiness = Invoke-Api -Method 'GET' -Path '/api/business/my' -Token $VendorToken
    $bizOk = ($myBusiness.statusCode -eq 200 -and $myBusiness.body)
    Add-Result '/api/business/my' 'business record after PUT' '200 with payload' "HTTP $($myBusiness.statusCode)" $myBusiness.statusCode 'backend' $(if ($bizOk) { 'P2' } else { 'P0' })
    Write-Host "$(if ($bizOk) { 'PASS' } else { 'FAIL' })  GET /api/business/my -> $($myBusiness.statusCode)"
}

Write-Host ""
Write-Host "=== Evidence rows: $($Results.Count) ==="
$Results | Format-Table route, action, expected, actual, statusCode, owner, severity -AutoSize
