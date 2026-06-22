# Service publication visibility smoke - sanitized output only.
# Requires session env vars (never commit values):
#   SMOKE_TEST_VENDOR_TOKEN
#   SMOKE_TEST_BUSINESS_ID
#   SMOKE_TEST_SERVICE_CATEGORY_ID
#   SMOKE_TEST_SERVICE_SUBCATEGORY_ID
# Optional:
#   API_BASE_URL (default https://api.mosaicbizhub.com)

param(
    [string]$ApiBaseUrl = $(if ($env:API_BASE_URL) { $env:API_BASE_URL } else { "https://api.mosaicbizhub.com" }),
    [string]$VendorToken = $env:SMOKE_TEST_VENDOR_TOKEN,
    [string]$BusinessId = $env:SMOKE_TEST_BUSINESS_ID,
    [string]$CategoryId = $env:SMOKE_TEST_SERVICE_CATEGORY_ID,
    [string]$SubcategoryId = $env:SMOKE_TEST_SERVICE_SUBCATEGORY_ID
)

$ErrorActionPreference = 'Stop'
$Base = $ApiBaseUrl.TrimEnd('/')
$Results = @()

function Add-Result($route, $action, $expected, $actual, $statusCode, $severity) {
    $script:Results += [pscustomobject]@{
        route      = $route
        action     = $action
        expected   = $expected
        actual     = $actual
        statusCode = $statusCode
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

Write-Host "Service publication smoke against $Base"

if (-not $VendorToken -or -not $BusinessId -or -not $CategoryId -or -not $SubcategoryId) {
    Add-Result 'setup' 'env-check' 'required smoke env vars present' 'BLOCKED - missing vendor/business/category env' 0 'P0-blocker-env'
    $Results | Format-Table -AutoSize
    exit 2
}

$health = Invoke-Api 'GET' '/api/health'
Add-Result '/api/health' 'liveness' '200' $(if ($health.statusCode -eq 200) { 'PASS' } else { 'FAIL' }) $health.statusCode 'info'

$ready = Invoke-Api 'GET' '/api/ready'
Add-Result '/api/ready' 'readiness' '200' $(if ($ready.statusCode -eq 200) { 'PASS' } else { 'FAIL' }) $ready.statusCode 'info'

$createBody = @{
    title          = 'Smoke Service Listing'
    description    = 'Sanitized smoke draft service'
    price          = 45
    duration       = '60'
    businessId     = $BusinessId
    categoryId     = $CategoryId
    subcategoryId  = $SubcategoryId
    isPublished    = $false
    services       = @(@{ name = 'Smoke Offering' })
}

$create = Invoke-Api 'POST' '/api/service/' $VendorToken $createBody
$serviceId = $null
if ($create.statusCode -eq 201 -and $create.body.data.service._id) {
    $serviceId = [string]$create.body.data.service._id
    Add-Result 'POST /api/service/' 'create-draft' '201 + service id' 'PASS' $create.statusCode 'info'
} elseif ($create.statusCode -eq 409 -and $create.body.existingServiceId) {
    $serviceId = [string]$create.body.existingServiceId
    Add-Result 'POST /api/service/' 'create-draft' '201 or existing id' 'PASS-existing' $create.statusCode 'info'
} else {
    Add-Result 'POST /api/service/' 'create-draft' '201 + service id' 'FAIL' $create.statusCode 'P0'
}

if ($serviceId) {
    $private = Invoke-Api 'GET' "/api/private/services/list?businessId=$BusinessId" $VendorToken
    $privateHas = $false
    if ($private.body.data) {
        foreach ($item in $private.body.data) {
            if ([string]$item._id -eq $serviceId) { $privateHas = $true; break }
        }
    }
    Add-Result 'GET /api/private/services/list' 'draft-visible-private' 'contains service id' $(if ($privateHas) { 'PASS' } else { 'FAIL' }) $private.statusCode 'P0'

    $publicListDraft = Invoke-Api 'GET' '/api/services/list'
    $publicHasDraft = $false
    if ($publicListDraft.body.data) {
        foreach ($item in $publicListDraft.body.data) {
            $id = if ($item.id) { [string]$item.id } else { [string]$item._id }
            if ($id -eq $serviceId) { $publicHasDraft = $true; break }
        }
    }
    Add-Result 'GET /api/services/list' 'draft-hidden-public' 'excludes service id' $(if (-not $publicHasDraft) { 'PASS' } else { 'FAIL' }) $publicListDraft.statusCode 'P0'

    $publish = Invoke-Api 'PUT' "/api/service/$serviceId" $VendorToken @{ isPublished = $true }
    Add-Result 'PUT /api/service/:id' 'publish' '200 + isPubliclyVisible=true' $(if ($publish.statusCode -eq 200 -and $publish.body.data.publication.isPubliclyVisible) { 'PASS' } else { 'FAIL' }) $publish.statusCode 'P0'

    $publicList = Invoke-Api 'GET' '/api/services/list'
    $publicHas = $false
    if ($publicList.body.data) {
        foreach ($item in $publicList.body.data) {
            $id = if ($item.id) { [string]$item.id } else { [string]$item._id }
            if ($id -eq $serviceId) { $publicHas = $true; break }
        }
    }
    Add-Result 'GET /api/services/list' 'published-visible-public' 'contains service id' $(if ($publicHas) { 'PASS' } else { 'FAIL' }) $publicList.statusCode 'P0'

    $publicDetail = Invoke-Api 'GET' "/api/public/services/$serviceId"
    Add-Result 'GET /api/public/services/:id' 'published-detail' '200' $(if ($publicDetail.statusCode -eq 200) { 'PASS' } else { 'FAIL' }) $publicDetail.statusCode 'P0'

    $unpublish = Invoke-Api 'PUT' "/api/service/$serviceId" $VendorToken @{ isPublished = $false }
    Add-Result 'PUT /api/service/:id' 'unpublish' '200' $(if ($unpublish.statusCode -eq 200) { 'PASS' } else { 'FAIL' }) $unpublish.statusCode 'info'

    $publicDetailHidden = Invoke-Api 'GET' "/api/public/services/$serviceId"
    Add-Result 'GET /api/public/services/:id' 'unpublished-detail-hidden' '404' $(if ($publicDetailHidden.statusCode -eq 404) { 'PASS' } else { 'FAIL' }) $publicDetailHidden.statusCode 'info'
}

$Results | Format-Table -AutoSize
$failed = @($Results | Where-Object { $_.actual -like 'FAIL*' -and $_.severity -eq 'P0' })
if ($failed.Count -gt 0) { exit 1 }
exit 0
