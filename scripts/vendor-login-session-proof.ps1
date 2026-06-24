# Vendor login session proof — credentialed cross-origin probe (no secrets in output).
# Usage:
#   $env:SMOKE_TEST_VENDOR_EMAIL = 'vendor-test@example.com'
#   $env:SMOKE_TEST_VENDOR_PASSWORD = '<password>'
#   ./scripts/vendor-login-session-proof.ps1 -ApiBaseUrl https://api.mosaicbizhub.com
#
# Optional: SMOKE_TEST_VENDOR_TOKEN for Bearer-only follow-up (skips login step).

param(
    [string]$ApiBaseUrl = $(if ($env:API_BASE_URL) { $env:API_BASE_URL } else { "https://api.mosaicbizhub.com" }),
    [string]$FrontendOrigin = $(if ($env:FRONTEND_ORIGIN) { $env:FRONTEND_ORIGIN } else { "https://mosaicbizhub.com" }),
    [string]$VendorEmail = $env:SMOKE_TEST_VENDOR_EMAIL,
    [string]$VendorPassword = $env:SMOKE_TEST_VENDOR_PASSWORD,
    [string]$VendorToken = $env:SMOKE_TEST_VENDOR_TOKEN,
    [string]$CookieJar = $(Join-Path $env:TEMP "mosaic-vendor-login-cookies.txt")
)

$ErrorActionPreference = 'Stop'
$Base = $ApiBaseUrl.TrimEnd('/')

function Write-Proof($status, $msg) {
    $color = switch ($status) {
        'PASS' { 'Green' }
        'FAIL' { 'Red' }
        'BLOCKED' { 'DarkYellow' }
        'INFO' { 'Cyan' }
        default { 'White' }
    }
    Write-Host "$status  $msg" -ForegroundColor $color
}

function Get-HttpResponse($Uri, $Method = 'GET', $Headers = @{}, $Body = $null, $WebSession = $null) {
    try {
        $params = @{
            Uri             = $Uri
            Method          = $Method
            Headers         = $Headers
            UseBasicParsing = $true
            ErrorAction     = 'Stop'
        }
        if ($Body) {
            $params.Body = $Body
            $params.ContentType = 'application/json'
        }
        if ($WebSession) { $params.WebSession = $WebSession }
        $r = Invoke-WebRequest @params
        return @{ StatusCode = [int]$r.StatusCode; Response = $r; Error = $null }
    } catch {
        if ($_.Exception.Response) {
            $resp = $_.Exception.Response
            $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
            $content = $reader.ReadToEnd()
            $reader.Close()
            return @{
                StatusCode = [int]$resp.StatusCode.value__
                Response   = @{ Content = $content; Headers = @{} }
                Error      = $null
            }
        }
        return @{ StatusCode = 0; Response = $null; Error = $_.Exception.Message }
    }
}

function Redact-SetCookie($headerValue) {
    if (-not $headerValue) { return '(none)' }
    $parts = @()
    foreach ($line in @($headerValue)) {
        if ($line -match '^([^=]+)=([^;]+)(.*)$') {
            $parts += "$($Matches[1])=<redacted>$($Matches[3])"
        } else {
            $parts += '<redacted>'
        }
    }
    return ($parts -join '; ')
}

Write-Host "=== Vendor Login Session Proof ==="
Write-Host "API=$Base Origin=$FrontendOrigin"
Write-Host ""

# P1: CORS preflight on login
try {
    $cors = Invoke-WebRequest -Uri "$Base/api/users/login" -Method OPTIONS `
        -Headers @{
            Origin = $FrontendOrigin
            'Access-Control-Request-Method' = 'POST'
            'Access-Control-Request-Headers' = 'content-type'
        } -UseBasicParsing
    $acao = $cors.Headers['Access-Control-Allow-Origin']
    $acac = $cors.Headers['Access-Control-Allow-Credentials']
    if ($cors.StatusCode -in 200, 204 -and $acao -eq $FrontendOrigin -and $acac -eq 'true') {
        Write-Proof 'PASS' "CORS preflight POST /api/users/login ($($cors.StatusCode), ACAO=$FrontendOrigin, credentials=true)"
    } else {
        Write-Proof 'FAIL' "CORS preflight ($($cors.StatusCode), ACAO=$acao, credentials=$acac)"
    }
} catch {
    Write-Proof 'FAIL' "CORS preflight - $($_.Exception.Message)"
}

# P2: Unauth auth/check baseline
$anon = Get-HttpResponse -Uri "$Base/api/users/auth/check" -Headers @{ Origin = $FrontendOrigin }
if ($anon.Error) {
    Write-Proof 'FAIL' "Unauth auth/check - $($anon.Error)"
} elseif ($anon.StatusCode -eq 401) {
    Write-Proof 'PASS' "Unauth GET /api/users/auth/check (401)"
} else {
    Write-Proof 'FAIL' "Unauth auth/check ($($anon.StatusCode), expected 401)"
}

if (-not $VendorEmail -or -not $VendorPassword) {
    if ($VendorToken) {
        Write-Proof 'INFO' 'Login step skipped — using SMOKE_TEST_VENDOR_TOKEN for follow-up probes'
    } else {
        Write-Proof 'BLOCKED' 'Credentialed login — set SMOKE_TEST_VENDOR_EMAIL and SMOKE_TEST_VENDOR_PASSWORD (or SMOKE_TEST_VENDOR_TOKEN)'
        exit 0
    }
}

if ($VendorEmail -and $VendorPassword) {
    if (Test-Path $CookieJar) { Remove-Item $CookieJar -Force }

    $loginBody = @{ email = $VendorEmail; password = $VendorPassword } | ConvertTo-Json
    try {
        $login = Invoke-WebRequest -Uri "$Base/api/users/login" -Method POST `
            -Headers @{ Origin = $FrontendOrigin; 'Content-Type' = 'application/json' } `
            -Body $loginBody -SessionVariable 'session' -UseBasicParsing

        $setCookie = $login.Headers['Set-Cookie']
        $redactedCookies = Redact-SetCookie $setCookie
        Write-Proof 'INFO' "POST /api/users/login HTTP $($login.StatusCode)"
        Write-Proof 'INFO' "Set-Cookie: $redactedCookies"

        if ($login.Content) {
            $parsed = $login.Content | ConvertFrom-Json
            $role = $parsed.user.role
            $verified = $parsed.user.isOtpVerified
            Write-Proof 'INFO' "Body: success=$($parsed.success) role=$role isOtpVerified=$verified (token redacted)"
        }

        if ($login.StatusCode -ne 200) {
            Write-Proof 'FAIL' "Vendor login expected 200, got $($login.StatusCode)"
            exit 1
        }

        if (-not $setCookie) {
            Write-Proof 'FAIL' 'Login 200 but no Set-Cookie headers'
            exit 1
        }

        $hasToken = ($setCookie -match 'token=')
        $hasSession = ($setCookie -match 'user_session=')
        if ($hasToken -and $hasSession) {
            Write-Proof 'PASS' 'Set-Cookie includes token and user_session'
        } else {
            Write-Proof 'FAIL' 'Set-Cookie missing expected cookie names'
        }

        foreach ($flag in @('HttpOnly', 'Secure', 'SameSite=None', 'Domain=.mosaicbizhub.com', 'Path=/')) {
            if ($setCookie -match [regex]::Escape($flag) -or ($flag -eq 'SameSite=None' -and $setCookie -match 'SameSite=None')) {
                Write-Proof 'PASS' "Cookie attribute present: $flag"
            } else {
                Write-Proof 'FAIL' "Cookie attribute missing: $flag"
            }
        }

        # Save cookies for curl-style follow-up
        $session.Cookies.GetCookies([Uri]$Base) | ForEach-Object {
            "$($_.Name)=<redacted>; domain=$($_.Domain); path=$($_.Path); secure=$($_.Secure); httponly=$($_.HttpOnly)"
        } | Out-File -FilePath $CookieJar -Encoding utf8

        $check = Invoke-WebRequest -Uri "$Base/api/users/auth/check" -Method GET `
            -WebSession $session -Headers @{ Origin = $FrontendOrigin } -UseBasicParsing
        if ($check.StatusCode -eq 200) {
            $checkBody = $check.Content | ConvertFrom-Json
            Write-Proof 'PASS' "Cookie auth/check 200 role=$($checkBody.user.role)"
        } else {
            Write-Proof 'FAIL' "Cookie auth/check $($check.StatusCode) (expected 200)"
        }

        $biz = Invoke-WebRequest -Uri "$Base/api/business/my" -Method GET `
            -WebSession $session -Headers @{ Origin = $FrontendOrigin } -UseBasicParsing
        if ($biz.StatusCode -eq 200) {
            Write-Proof 'PASS' "GET /api/business/my 200"
        } else {
            Write-Proof 'FAIL' "GET /api/business/my $($biz.StatusCode) (expected 200)"
        }

        try {
            $onb = Invoke-WebRequest -Uri "$Base/api/vendor-onboarding/onboarding-data" -Method GET `
                -WebSession $session -Headers @{ Origin = $FrontendOrigin } -UseBasicParsing
            $onbStatus = $onb.StatusCode
        } catch {
            if ($_.Exception.Response) {
                $onbStatus = [int]$_.Exception.Response.StatusCode.value__
            } else { throw }
        }
        if ($onbStatus -in 200, 404) {
            Write-Proof 'PASS' "GET /api/vendor-onboarding/onboarding-data $onbStatus (404 expected for fresh vendor)"
        } elseif ($onbStatus -eq 401) {
            Write-Proof 'FAIL' 'onboarding-data returned 401 — session not sent or invalid'
        } else {
            Write-Proof 'INFO' "GET onboarding-data $onbStatus"
        }
    } catch {
        Write-Proof 'FAIL' "Login probe failed: $($_.Exception.Message)"
        exit 1
    }
} elseif ($VendorToken) {
    $hdr = @{ Authorization = "Bearer $VendorToken"; Origin = $FrontendOrigin }
    foreach ($pair in @(
            @{ Name = 'auth/check'; Url = "$Base/api/users/auth/check"; Expect = @(200) },
            @{ Name = 'business/my'; Url = "$Base/api/business/my"; Expect = @(200) },
            @{ Name = 'onboarding-data'; Url = "$Base/api/vendor-onboarding/onboarding-data"; Expect = @(200, 404) }
        )) {
        $r = Get-HttpResponse -Uri $pair.Url -Headers $hdr
        if ($r.Error) {
            Write-Proof 'FAIL' "$($pair.Name) - $($r.Error)"
            continue
        }
        $ok = @($pair.Expect) -contains $r.StatusCode
        if ($ok) { Write-Proof 'PASS' "$($pair.Name) $($r.StatusCode)" }
        else { Write-Proof 'FAIL' "$($pair.Name) $($r.StatusCode) (expected $($pair.Expect -join '/'))" }
    }
}

Write-Host ''
Write-Host '=== Proof complete (no secrets logged) ==='
