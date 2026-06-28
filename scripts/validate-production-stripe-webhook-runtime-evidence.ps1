# Validate redacted Stripe webhook runtime smoke output before it is summarized
# in GitHub. This script does not send requests, does not read env values, and
# does not print any detected secret-like values.
param(
  [string]$ResultsFile = "docs/qa-redacted/production-stripe-webhook-runtime-2026-06-28/stripe-webhook-runtime-redacted-results.json",
  [switch]$AllowDryRun,
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"

if ($ValidateOnly) {
  Write-Host "validate-production-stripe-webhook-runtime-evidence.ps1 validation OK"
  return
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$resultsFullPath = if ([System.IO.Path]::IsPathRooted($ResultsFile)) {
  $ResultsFile
} else {
  Join-Path $repoRoot $ResultsFile
}

if (-not (Test-Path -LiteralPath $resultsFullPath)) {
  throw "Results file not found: $ResultsFile"
}

$raw = Get-Content -LiteralPath $resultsFullPath -Raw
$issues = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

function Add-Issue {
  param([string]$Message)
  $issues.Add($Message) | Out-Null
}

function Add-Warning {
  param([string]$Message)
  $warnings.Add($Message) | Out-Null
}

$forbiddenPatterns = [ordered]@{
  "Stripe secret key" = "(?i)\bsk_(live|test)_[A-Za-z0-9]{10,}\b"
  "Stripe restricted key" = "(?i)\brk_(live|test)_[A-Za-z0-9]{10,}\b"
  "Stripe webhook secret" = "(?i)\bwhsec_[A-Za-z0-9]{10,}\b"
  "Stripe client secret" = "(?i)\b(pi|seti|si|cs)_[A-Za-z0-9]+_secret_[A-Za-z0-9]+\b"
  "JWT-like token" = "\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"
  "GitHub token" = "\bgh[pousr]_[A-Za-z0-9_]{20,}\b"
  "Bearer token" = "(?i)\bBearer\s+[A-Za-z0-9._~+/-]{20,}\b"
  "Full Stripe URL" = "(?i)https://(connect|dashboard)\.stripe\.com/[^\s)]+"
}

foreach ($entry in $forbiddenPatterns.GetEnumerator()) {
  if ([regex]::IsMatch($raw, $entry.Value, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
    Add-Issue "Forbidden or secret-like content detected: $($entry.Key). Remove or redact before sharing."
  }
}

try {
  $results = $raw | ConvertFrom-Json
} catch {
  throw "Results file is not valid JSON: $ResultsFile"
}

if ($results.runType -ne "production-stripe-webhook-runtime") {
  Add-Issue "Unexpected runType: $($results.runType)"
}

if ([string]::IsNullOrWhiteSpace([string]$results.testedAt)) {
  Add-Issue "Missing testedAt timestamp."
}

if ([string]::IsNullOrWhiteSpace([string]$results.apiHost)) {
  Add-Issue "Missing apiHost."
}

$mutationPolicy = $results.mutationPolicy
if ($null -eq $mutationPolicy) {
  Add-Issue "Missing mutationPolicy."
} else {
  foreach ($field in @("signedStripeEventsSent", "signingSecretsSent", "paymentMethodsSubmitted", "orderOrVendorStateMutationExpected")) {
    if ($mutationPolicy.$field -ne $false) {
      Add-Issue "mutationPolicy.$field must be false for this redacted smoke lane."
    }
  }
}

$redaction = $results.redaction
if ($null -eq $redaction) {
  Add-Issue "Missing redaction block."
} else {
  foreach ($field in @("webhookSecrets", "stripeSignatures", "requestBodies", "responseBodies", "endpointSecrets")) {
    if ([string]::IsNullOrWhiteSpace([string]$redaction.$field)) {
      Add-Issue "Missing redaction.$field."
    }
  }
}

$expectedScenarios = @(
  "orderStatus",
  "businessDraftCheckout",
  "subscriptionBilling",
  "vendorVerificationPayment",
  "orderPostPayment"
)

if ($null -eq $results.scenarios) {
  Add-Issue "Missing scenarios."
} else {
  foreach ($name in $expectedScenarios) {
    $scenario = $results.scenarios.$name
    if ($null -eq $scenario) {
      Add-Issue "Missing scenario: $name"
      continue
    }

    if ([string]::IsNullOrWhiteSpace([string]$scenario.path)) {
      Add-Issue "Scenario $name is missing path."
    }
    if ([string]::IsNullOrWhiteSpace([string]$scenario.envVar)) {
      Add-Issue "Scenario $name is missing env var name."
    }
    if ($scenario.pass -ne $true) {
      Add-Issue "Scenario $name did not pass."
    }

    if ($scenario.status -eq "skipped") {
      if (-not $AllowDryRun) {
        Add-Issue "Scenario $name is skipped. Run with -SendUnsignedProbes or validate with -AllowDryRun for dry-run evidence only."
      } else {
        Add-Warning "Scenario $name is dry-run skipped; this is not unsigned-rejection runtime proof."
      }
    } elseif ([int]$scenario.status -ne 400) {
      Add-Issue "Scenario $name expected HTTP 400 for unsigned rejection, observed $($scenario.status)."
    }
  }
}

if ($results.verdict -ne "PASS") {
  Add-Issue "Results verdict is not PASS: $($results.verdict)"
}

if ($AllowDryRun) {
  Add-Warning "AllowDryRun is enabled. This validates redaction/shape only; it does not prove production unsigned webhook rejection."
}

$summary = [ordered]@{
  resultsFile = $ResultsFile
  allowDryRun = [bool]$AllowDryRun
  issueCount = $issues.Count
  warningCount = $warnings.Count
  result = if ($issues.Count -eq 0) { "PASS" } else { "FAIL" }
  warnings = @($warnings)
  issues = @($issues)
}

$summary | ConvertTo-Json -Depth 6

if ($issues.Count -gt 0) {
  exit 1
}
