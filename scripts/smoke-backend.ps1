# Lightweight backend smoke tests - public endpoints first, optional auth if tokens set.
# Usage: ./scripts/smoke-backend.ps1 -ApiBaseUrl https://api.mosaicbizhub.com
# Optional auth: -CustomerToken / -VendorToken / -AdminToken (or SMOKE_TEST_* env vars)
# See docs/SMOKE_TEST_TOKENS.md

param(
    [string]$ApiBaseUrl = $(if ($env:API_BASE_URL) { $env:API_BASE_URL } else { "http://localhost:3001" }),
    [string]$CustomerToken,
    [string]$VendorToken,
    [string]$AdminToken,
    [string]$ProductId,
    [string]$FrontendOrigin,
    [string]$BusinessId
)

if ($CustomerToken) { $env:SMOKE_TEST_CUSTOMER_TOKEN = $CustomerToken }
if ($VendorToken) { $env:SMOKE_TEST_VENDOR_TOKEN = $VendorToken }
if ($AdminToken) { $env:SMOKE_TEST_ADMIN_TOKEN = $AdminToken }
if ($ProductId) { $env:SMOKE_TEST_PRODUCT_ID = $ProductId }
if ($FrontendOrigin) { $env:FRONTEND_ORIGIN = $FrontendOrigin }
if ($BusinessId) { $env:SMOKE_TEST_BUSINESS_ID = $BusinessId }

$Base = $ApiBaseUrl.TrimEnd('/')
$Pass = 0
$Fail = 0
$Skip = 0
$Blocked = 0

function Write-SmokePass($msg) { Write-Host "PASS  $msg" -ForegroundColor Green; $script:Pass++ }
function Write-SmokeFail($msg) { Write-Host "FAIL  $msg" -ForegroundColor Red; $script:Fail++ }
function Write-SmokeSkip($msg, $reason) { Write-Host "SKIP  $msg - $reason" -ForegroundColor Yellow; $script:Skip++ }
function Write-SmokeBlocked($msg, $reason) { Write-Host "BLOCKED  $msg - $reason" -ForegroundColor DarkYellow; $script:Blocked++ }

function Get-StatusCode($Uri, $Method = 'GET', $Headers = @{}, $Body = $null) {
    try {
        $params = @{
            Uri             = $Uri
            Method          = $Method
            Headers         = $Headers
            UseBasicParsing = $true
            ErrorAction     = 'Stop'
        }
        if ($Body) { $params.Body = $Body; $params.ContentType = 'application/json' }
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

function Get-AuthHeader($token) {
    if (-not $token) { return $null }
    if ($token -match '^\s*Bearer\s') { return $token }
    return "Bearer $token"
}

Write-Host "=== Mosaic Backend Smoke ==="
Write-Host "API_BASE_URL=$Base"
Write-Host ""

$code = Get-StatusCode "$Base/"
if ($code -eq 200) { Write-SmokePass "P0.1 GET / ($code)" } else { Write-SmokeFail "P0.1 GET / ($code, expected 200)" }

$code = Get-StatusCode "$Base/api/health"
if ($code -eq 200) { Write-SmokePass "P0.2 GET /api/health ($code)" } else { Write-SmokeFail "P0.2 GET /api/health ($code, expected 200)" }

$code = Get-StatusCode "$Base/api/ready"
if ($code -eq 200) { Write-SmokePass "P0.3 GET /api/ready ($code)" } else { Write-SmokeFail "P0.3 GET /api/ready ($code, expected 200)" }

function Test-ReleaseIdentity([string]$Path) {
    try {
        $response = Invoke-WebRequest -Uri "$Base$Path" -UseBasicParsing -ErrorAction Stop
        $json = $response.Content | ConvertFrom-Json
        if (-not $json.release) { return $false }
        foreach ($field in @('commit', 'environment', 'deploymentVersion')) {
            if (-not $json.release.$field) { return $false }
        }
        $serialized = ($json.release | ConvertTo-Json -Compress).ToLower()
        foreach ($bad in @('sk_live_', 'sk_test_', 'whsec_', 'sentry_dsn', 'mongodb', 'password', 'secret')) {
            if ($serialized.Contains($bad)) { return $false }
        }
        return $true
    } catch {
        return $false
    }
}

if (Test-ReleaseIdentity '/api/health') {
    Write-SmokePass 'P0.5 GET /api/health release identity'
} else {
    Write-SmokeFail 'P0.5 GET /api/health release identity missing or unsafe'
}

if (Test-ReleaseIdentity '/api/build-info') {
    Write-SmokePass 'P0.6 GET /api/build-info release identity'
} else {
    Write-SmokeFail 'P0.6 GET /api/build-info release identity missing or unsafe'
}

try {
    $healthResp = Invoke-WebRequest -Uri "$Base/api/health" -UseBasicParsing -ErrorAction Stop
    $requestId = $healthResp.Headers['X-Request-Id']
    if ($requestId) {
        Write-SmokePass "P0.7 GET /api/health X-Request-Id present"
    } else {
        Write-SmokeFail 'P0.7 GET /api/health missing X-Request-Id header'
    }
} catch {
    Write-SmokeFail "P0.7 GET /api/health X-Request-Id check - $($_.Exception.Message)"
}

$code = Get-StatusCode "$Base/api/users/auth/check"
if ($code -eq 401) { Write-SmokePass "P2.1 GET /api/users/auth/check unauth ($code)" } else { Write-SmokeFail "P2.1 GET /api/users/auth/check ($code, expected 401)" }

$paths = @(
    '/api/featured-products',
    '/api/products/list?limit=5',
    '/api/public/search?keyword=test&limit=5',
    '/api/services/list?limit=5',
    '/api/food/list?limit=5'
)
foreach ($p in $paths) {
    $code = Get-StatusCode "$Base$p"
    if ($code -eq 200) { Write-SmokePass "P1 GET $p ($code)" } else { Write-SmokeFail "P1 GET $p ($code, expected 200)" }
}

$corsOrigins = @(
    'https://app.mosaicbizhub.com',
    'https://mosaic-biz-frontend-launch.vercel.app'
)
if ($env:FRONTEND_ORIGIN) {
    $corsOrigins = @($env:FRONTEND_ORIGIN)
}
foreach ($corsOrigin in $corsOrigins) {
    try {
        $corsHeaders = @{
            Origin                         = $corsOrigin
            'Access-Control-Request-Method' = 'GET'
        }
        $cors = Invoke-WebRequest -Uri "$Base/api/featured-products" -Method OPTIONS -Headers $corsHeaders -UseBasicParsing -ErrorAction Stop
        $allowOrigin = $cors.Headers['Access-Control-Allow-Origin']
        $allowCreds = $cors.Headers['Access-Control-Allow-Credentials']
        $corsOk = $cors.StatusCode -in 200, 204 -and $allowOrigin -eq $corsOrigin
        if ($corsOk -and ($allowCreds -eq 'true' -or $allowCreds -eq $true)) {
            Write-SmokePass "P0.4 CORS preflight ($($cors.StatusCode), Origin=$corsOrigin, credentials=true)"
        } elseif ($corsOk) {
            Write-SmokeFail "P0.4 CORS preflight ($($cors.StatusCode), Origin=$corsOrigin, missing Allow-Credentials)"
        } else {
            Write-SmokeFail "P0.4 CORS preflight ($($cors.StatusCode), Allow-Origin=$allowOrigin, expected $corsOrigin)"
        }
    } catch {
        Write-SmokeFail "P0.4 CORS preflight Origin=$corsOrigin - $($_.Exception.Message)"
    }
}

$code = Get-StatusCode "$Base/api/admin/categories"
if ($code -eq 200) {
    Write-SmokePass "NOTE GET /api/admin/categories unauth ($code) - public exposure documented"
} else {
    Write-SmokeFail "NOTE GET /api/admin/categories $code - expected 200 on current main"
}

$code = Get-StatusCode "$Base/admin/api/products/test"
if ($code -eq 200) {
    Write-SmokePass "NOTE GET /admin/api/products/test unauth ($code) - debug route pending PR 96 removal"
} elseif ($code -eq 404) {
    Write-SmokePass "NOTE GET /admin/api/products/test absent ($code) - PR 96 fix deployed"
} else {
    Write-SmokeFail "NOTE GET /admin/api/products/test $code - expected 200 on main or 404 after PR 96"
}

$code = Get-StatusCode -Uri "$Base/api/orders/initiate" -Method POST -Body '{}'
if ($code -eq 401) { Write-SmokePass "P4.2 POST /api/orders/initiate unauth ($code)" } else { Write-SmokeFail "P4.2 POST /api/orders/initiate ($code, expected 401)" }

try {
    $errResp = Invoke-WebRequest -Uri "$Base/api/orders/initiate" -Method POST -Body '{}' -UseBasicParsing -ErrorAction Stop
    Write-SmokeFail 'P4.2b POST /api/orders/initiate should not return 2xx unauth'
} catch {
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $body = $reader.ReadToEnd()
        $reader.Close()
        if ($body -match 'stack|at Object\.|node_modules') {
            Write-SmokeFail 'P4.2b error envelope leaks stack trace'
        } else {
            Write-SmokePass 'P4.2b unauth error envelope safe (no stack trace)'
        }
    } else {
        Write-SmokeFail "P4.2b error envelope check - $($_.Exception.Message)"
    }
}

$code = Get-StatusCode -Uri "$Base/api/connect/000000000000000000000000/account-link" -Method POST -Body '{}'
if ($code -eq 401) { Write-SmokePass "P5.1 POST /api/connect/:id/account-link unauth ($code)" } else { Write-SmokeFail "P5.1 POST /api/connect/:id/account-link ($code, expected 401)" }

$code = Get-StatusCode "$Base/api/products/featured"
if ($code -eq 404) { Write-SmokePass "P6.0 GET /api/products/featured absent ($code)" } else { Write-SmokeFail "P6.0 GET /api/products/featured ($code, expected 404)" }

$code = Get-StatusCode "$Base/admin/users"
if ($code -eq 401) { Write-SmokePass "P3.0 GET /admin/users unauth ($code)" } else { Write-SmokeFail "P3.0 GET /admin/users ($code, expected 401)" }

$code = Get-StatusCode "$Base/admin/api/products"
if ($code -eq 401) { Write-SmokePass "P3.1 GET /admin/api/products unauth ($code)" } else { Write-SmokeFail "P3.1 GET /admin/api/products ($code, expected 401)" }

$code = Get-StatusCode -Uri "$Base/api/payments/create-payment-intent" -Method POST -Body '{}'
if ($code -eq 401) { Write-SmokePass "P4.3 POST /api/payments/create-payment-intent unauth ($code)" } else { Write-SmokeFail "P4.3 POST /api/payments/create-payment-intent ($code, expected 401)" }

$code = Get-StatusCode "$Base/stripe/account-balance"
if ($code -eq 401) { Write-SmokePass "P5.0 GET /stripe/account-balance unauth ($code)" } else { Write-SmokeFail "P5.0 GET /stripe/account-balance ($code, expected 401)" }

if ($env:SMOKE_TEST_CUSTOMER_TOKEN) {
    $hdr = @{ Authorization = (Get-AuthHeader $env:SMOKE_TEST_CUSTOMER_TOKEN) }
    $code = Get-StatusCode -Uri "$Base/api/users/auth/check" -Headers $hdr
    if ($code -eq 200) { Write-SmokePass "P2.2 customer auth/check ($code)" } else { Write-SmokeFail "P2.2 customer auth/check ($code)" }
} else {
    Write-SmokeBlocked 'P2.2 customer auth' 'SMOKE_TEST_CUSTOMER_TOKEN not set'
}

if ($env:SMOKE_TEST_VENDOR_TOKEN) {
    $hdr = @{ Authorization = (Get-AuthHeader $env:SMOKE_TEST_VENDOR_TOKEN) }
    $code = Get-StatusCode -Uri "$Base/api/users/auth/check" -Headers $hdr
    if ($code -eq 200) { Write-SmokePass "P2.3 vendor auth/check ($code)" } else { Write-SmokeFail "P2.3 vendor auth/check ($code)" }

    $code = Get-StatusCode -Uri "$Base/api/business/my" -Headers $hdr
    if ($code -eq 200) { Write-SmokePass "P2.5 vendor GET /api/business/my ($code)" } else { Write-SmokeFail "P2.5 vendor GET /api/business/my ($code, expected 200)" }

    $code = Get-StatusCode -Uri "$Base/api/vendor-onboarding/onboarding-data" -Headers $hdr
    if ($code -in 200, 404) {
        Write-SmokePass "P2.6 vendor GET /api/vendor-onboarding/onboarding-data ($code, 404 OK for fresh vendor)"
    } elseif ($code -eq 401) {
        Write-SmokeFail "P2.6 vendor onboarding-data $code - expected 200 or 404 not 401"
    } else {
        Write-SmokeFail "P2.6 vendor onboarding-data ($code, expected 200 or 404)"
    }
} else {
    Write-SmokeBlocked 'P2.3 vendor auth' 'SMOKE_TEST_VENDOR_TOKEN not set'
    Write-SmokeBlocked 'P2.5 vendor business/my' 'SMOKE_TEST_VENDOR_TOKEN not set'
    Write-SmokeBlocked 'P2.6 vendor onboarding-data' 'SMOKE_TEST_VENDOR_TOKEN not set'
}

if ($env:SMOKE_TEST_ADMIN_TOKEN) {
    $hdr = @{ Authorization = (Get-AuthHeader $env:SMOKE_TEST_ADMIN_TOKEN) }
    $code = Get-StatusCode -Uri "$Base/api/users/auth/check" -Headers $hdr
    if ($code -eq 200) { Write-SmokePass "P2.4 admin auth/check ($code)" } else { Write-SmokeFail "P2.4 admin auth/check ($code)" }
} else {
    Write-SmokeBlocked 'P2.4 admin auth' 'SMOKE_TEST_ADMIN_TOKEN not set'
}

if ($env:SMOKE_TEST_PRODUCT_ID) {
    $code = Get-StatusCode "$Base/api/public/product/$($env:SMOKE_TEST_PRODUCT_ID)"
    if ($code -eq 200) { Write-SmokePass "P1 product detail ($code)" } else { Write-SmokeFail "P1 product detail ($code)" }
} else {
    Write-SmokeSkip 'P1 product detail' 'SMOKE_TEST_PRODUCT_ID not set'
}

if ($env:SMOKE_TEST_BUSINESS_ID) {
    $code = Get-StatusCode "$Base/api/public/product/vendor-profile/$($env:SMOKE_TEST_BUSINESS_ID)"
    if ($code -in 200, 404) {
        Write-SmokePass "P1 vendor profile ($code, 404 OK if business inactive/unpublished)"
    } else {
        Write-SmokeFail "P1 vendor profile ($code, expected 200 or 404)"
    }
} else {
    Write-SmokeSkip 'P1 vendor profile' 'SMOKE_TEST_BUSINESS_ID not set'
}

Write-Host ''
Write-Host "=== Summary: PASS=$Pass FAIL=$Fail SKIP=$Skip BLOCKED=$Blocked ==="

if ($Fail -gt 0) { exit 1 }
exit 0
