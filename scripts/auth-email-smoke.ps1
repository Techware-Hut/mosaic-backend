# Auth OTP / forgot-password email delivery smoke — production-safe probes.
# Logs HTTP status codes only; never prints OTPs, tokens, or response bodies.
#
# Usage:
#   ./scripts/auth-email-smoke.ps1 -ApiBaseUrl https://api.mosaicbizhub.com
#   ./scripts/auth-email-smoke.ps1 -DisposableDomain your-disposable.testmail.app
#
# Optional env (session-only — do not commit):
#   SMOKE_TEST_CUSTOMER_EMAIL or MBH_TEST_CUSTOMER_EMAIL — known customer for forgot-password probe
#   SMOKE_TEST_VENDOR_EMAIL or MBH_TEST_VENDOR_EMAIL   — known vendor for forgot-password probe

param(
    [string]$ApiBaseUrl = $(if ($env:API_BASE_URL) { $env:API_BASE_URL } else { "https://api.mosaicbizhub.com" }),
    [string]$DisposableDomain = $(if ($env:SMOKE_DISPOSABLE_DOMAIN) { $env:SMOKE_DISPOSABLE_DOMAIN } else { "example.invalid" }),
    [int]$ProbeDelaySeconds = 30
)

$Base = $ApiBaseUrl.TrimEnd('/')
$Pass = 0
$Fail = 0
$Skip = 0

function Write-ProbePass($msg) { Write-Host "PASS  $msg" -ForegroundColor Green; $script:Pass++ }
function Write-ProbeFail($msg) { Write-Host "FAIL  $msg" -ForegroundColor Red; $script:Fail++ }
function Write-ProbeSkip($msg, $reason) { Write-Host "SKIP  $msg - $reason" -ForegroundColor Yellow; $script:Skip++ }

function Get-StatusCode($Uri, $Method = 'GET', $Body = $null) {
    try {
        $params = @{
            Uri             = $Uri
            Method          = $Method
            UseBasicParsing = $true
            ErrorAction     = 'Stop'
        }
        if ($Body) {
            $params.Body = $Body
            $params.ContentType = 'application/json'
        }
        $r = Invoke-WebRequest @params
        return [int]$r.StatusCode
    }
    catch {
        if ($_.Exception.Response) {
            return [int]$_.Exception.Response.StatusCode.value__
        }
        throw
    }
}

function Wait-ProbeDelay {
    if ($ProbeDelaySeconds -gt 0) {
        Write-Host "Waiting ${ProbeDelaySeconds}s before next probe (rate-limit spacing)..."
        Start-Sleep -Seconds $ProbeDelaySeconds
    }
}

function Get-TestAccountEmail($smokeVarName, $mbhVarName) {
    $smoke = [Environment]::GetEnvironmentVariable($smokeVarName)
    if ($smoke -and [string]::IsNullOrWhiteSpace($smoke) -eq $false) {
        return $smoke.Trim()
    }
    $mbh = [Environment]::GetEnvironmentVariable($mbhVarName)
    if ($mbh -and [string]::IsNullOrWhiteSpace($mbh) -eq $false) {
        return $mbh.Trim()
    }
    return $null
}

Write-Host "=== Auth Email Smoke ==="
Write-Host "API_BASE_URL=$Base"
Write-Host "PROBE_DELAY_SECONDS=$ProbeDelaySeconds"
Write-Host ""

# 1. Release identity (status only)
try {
    $buildCode = Get-StatusCode "$Base/api/build-info"
    if ($buildCode -eq 200) { Write-ProbePass "A1 GET /api/build-info ($buildCode)" } else { Write-ProbeFail "A1 GET /api/build-info ($buildCode, expected 200)" }
}
catch {
    Write-ProbeFail "A1 GET /api/build-info (request error)"
}

Wait-ProbeDelay

# 2. Ready probe (authEmail.configured when deployed)
try {
    $readyCode = Get-StatusCode "$Base/api/ready"
    if ($readyCode -eq 200) { Write-ProbePass "A2 GET /api/ready ($readyCode)" } else { Write-ProbeFail "A2 GET /api/ready ($readyCode, expected 200)" }
}
catch {
    Write-ProbeFail "A2 GET /api/ready (request error)"
}

Wait-ProbeDelay

# 3. Known customer forgot-password
$customerEmail = Get-TestAccountEmail 'SMOKE_TEST_CUSTOMER_EMAIL' 'MBH_TEST_CUSTOMER_EMAIL'
if ($customerEmail) {
    $body = @{ email = $customerEmail } | ConvertTo-Json -Compress
    $code = Get-StatusCode "$Base/api/users/forgot-password" -Method POST -Body $body
    if ($code -eq 200) { Write-ProbePass "A3 POST forgot-password customer ($code)" } else { Write-ProbeFail "A3 POST forgot-password customer ($code, expected 200)" }
}
else {
    Write-ProbeSkip "A3 POST forgot-password customer", "set SMOKE_TEST_CUSTOMER_EMAIL or MBH_TEST_CUSTOMER_EMAIL"
}

Wait-ProbeDelay

# 4. Known vendor forgot-password
$vendorEmail = Get-TestAccountEmail 'SMOKE_TEST_VENDOR_EMAIL' 'MBH_TEST_VENDOR_EMAIL'
if ($vendorEmail) {
    $body = @{ email = $vendorEmail } | ConvertTo-Json -Compress
    $code = Get-StatusCode "$Base/api/users/forgot-password" -Method POST -Body $body
    if ($code -eq 200) { Write-ProbePass "A4 POST forgot-password vendor ($code)" } else { Write-ProbeFail "A4 POST forgot-password vendor ($code, expected 200)" }
}
else {
    Write-ProbeSkip "A4 POST forgot-password vendor", "set SMOKE_TEST_VENDOR_EMAIL or MBH_TEST_VENDOR_EMAIL"
}

Wait-ProbeDelay

# 5. Disposable customer registration
$stamp = Get-Date -Format 'yyyyMMddHHmmss'
$customerDisposable = "mbh-smoke-customer-$stamp@$DisposableDomain"
$registerBody = @{
    name     = 'Smoke Customer'
    email    = $customerDisposable
    password = 'SmokeTest1!'
    mobile   = "+1555555$((Get-Random -Maximum 9999).ToString('0000'))"
    role     = 'customer'
} | ConvertTo-Json -Compress
$code = Get-StatusCode "$Base/api/users/register" -Method POST -Body $registerBody
if ($code -eq 201) { Write-ProbePass "A5 POST register customer ($code)" } elseif ($code -eq 502) { Write-ProbeFail "A5 POST register customer ($code, OTP delivery failed - check MAIL_USER/MAIL_PASSWORD on EB)" } else { Write-ProbeFail "A5 POST register customer ($code, expected 201)" }

Wait-ProbeDelay

# 6. Disposable vendor registration
$stamp = Get-Date -Format 'yyyyMMddHHmmss'
$vendorDisposable = "mbh-smoke-vendor-$stamp@$DisposableDomain"
$registerBody = @{
    name     = 'Smoke Vendor'
    email    = $vendorDisposable
    password = 'SmokeTest1!'
    mobile   = "+1555556$((Get-Random -Maximum 9999).ToString('0000'))"
    role     = 'business_owner'
} | ConvertTo-Json -Compress
$code = Get-StatusCode "$Base/api/users/register" -Method POST -Body $registerBody
if ($code -eq 201) { Write-ProbePass "A6 POST register vendor ($code)" } elseif ($code -eq 502) { Write-ProbeFail "A6 POST register vendor ($code, OTP delivery failed - check MAIL_USER/MAIL_PASSWORD on EB)" } else { Write-ProbeFail "A6 POST register vendor ($code, expected 201)" }

Wait-ProbeDelay

# 7. Resend OTP for disposable customer (from A5 if 201)
$resendEmail = $customerDisposable
$body = @{ email = $resendEmail } | ConvertTo-Json -Compress
$code = Get-StatusCode "$Base/api/users/resend-otp" -Method POST -Body $body
if ($code -eq 200) { Write-ProbePass "A7 POST resend-otp disposable customer ($code)" } elseif ($code -eq 404) { Write-ProbeSkip "A7 POST resend-otp", "account not created (register may have failed)" } elseif ($code -eq 502) { Write-ProbeFail "A7 POST resend-otp ($code, OTP delivery failed)" } else { Write-ProbeFail "A7 POST resend-otp ($code, expected 200)" }

Wait-ProbeDelay

# 8. Anti-enumeration — unknown forgot-password
$body = @{ email = 'nonexistent-smoke@example.invalid' } | ConvertTo-Json -Compress
$code = Get-StatusCode "$Base/api/users/forgot-password" -Method POST -Body $body
if ($code -eq 200) { Write-ProbePass "A8 POST forgot-password unknown ($code)" } else { Write-ProbeFail "A8 POST forgot-password unknown ($code, expected 200)" }

Write-Host ""
Write-Host "=== Summary ==="
Write-Host "PASS=$Pass FAIL=$Fail SKIP=$Skip"
Write-Host "Confirm inbox delivery manually for probes that returned 200/201 (do not log OTP values)."

if ($Fail -gt 0) { exit 1 }
exit 0
