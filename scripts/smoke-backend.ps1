# Lightweight backend smoke tests - public endpoints first, optional auth if tokens set.
# Usage: ./scripts/smoke-backend.ps1 -ApiBaseUrl https://api.mosaicbizhub.com

param(
    [string]$ApiBaseUrl = $(if ($env:API_BASE_URL) { $env:API_BASE_URL } else { "http://localhost:3001" })
)

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

$corsOrigin = if ($env:FRONTEND_ORIGIN) { $env:FRONTEND_ORIGIN } else { 'https://mosaic-biz-frontend-launch.vercel.app' }
try {
    $corsHeaders = @{
        Origin                         = $corsOrigin
        'Access-Control-Request-Method' = 'GET'
    }
    $cors = Invoke-WebRequest -Uri "$Base/api/featured-products" -Method OPTIONS -Headers $corsHeaders -UseBasicParsing -ErrorAction Stop
    $allowOrigin = $cors.Headers['Access-Control-Allow-Origin']
    if ($cors.StatusCode -in 200, 204 -and $allowOrigin -eq $corsOrigin) {
        Write-SmokePass "P0.4 CORS preflight ($($cors.StatusCode), Origin=$corsOrigin)"
    } else {
        Write-SmokeFail "P0.4 CORS preflight ($($cors.StatusCode), Allow-Origin=$allowOrigin, expected $corsOrigin)"
    }
} catch {
    Write-SmokeFail "P0.4 CORS preflight - $($_.Exception.Message)"
}

$code = Get-StatusCode -Uri "$Base/api/orders/initiate" -Method POST -Body '{}'
if ($code -eq 401) { Write-SmokePass "P4.2 POST /api/orders/initiate unauth ($code)" } else { Write-SmokeFail "P4.2 POST /api/orders/initiate ($code, expected 401)" }

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
} else {
    Write-SmokeBlocked 'P2.3 vendor auth' 'SMOKE_TEST_VENDOR_TOKEN not set'
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

Write-Host ''
Write-Host "=== Summary: PASS=$Pass FAIL=$Fail SKIP=$Skip BLOCKED=$Blocked ==="

if ($Fail -gt 0) { exit 1 }
exit 0
