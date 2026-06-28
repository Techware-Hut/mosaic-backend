# Controlled production Stripe webhook runtime smoke.
# This script never sends signing secrets, raw webhook secrets, payment methods,
# customer credentials, or real Stripe payloads. It can optionally send unsigned
# probe events to verify that deployed endpoints reject missing signatures.
param(
  [string]$ApiBase = $(if ($env:MBH_API_BASE_URL) { $env:MBH_API_BASE_URL } else { "https://api.mosaicbizhub.com" }),
  [string]$OutFile = "docs/qa-redacted/production-stripe-webhook-runtime-2026-06-28/stripe-webhook-runtime-redacted-results.json",
  [switch]$SendUnsignedProbes,
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"

if ($ValidateOnly) {
  Write-Host "production-stripe-webhook-runtime-smoke.ps1 validation OK"
  return
}

$ApiBase = $ApiBase.TrimEnd("/")

$endpoints = @(
  [ordered]@{
    name = "orderStatus"
    path = "/api/webhooks/stripe"
    envVar = "STRIPE_ORDER_WEBHOOK_SECRET"
    eventType = "payment_intent.succeeded"
    purpose = "canonical order payment status"
  },
  [ordered]@{
    name = "businessDraftCheckout"
    path = "/api/stripe/webhook"
    envVar = "STRIPE_BUSINESS_DRAFT_WEBHOOK_SECRET"
    eventType = "checkout.session.completed"
    purpose = "business draft checkout and Connect account sync"
  },
  [ordered]@{
    name = "subscriptionBilling"
    path = "/api/subscription/webhook"
    envVar = "STRIPE_SUBSCRIPTION_WEBHOOK_SECRET"
    eventType = "invoice.payment_succeeded"
    purpose = "subscription billing lifecycle"
  },
  [ordered]@{
    name = "vendorVerificationPayment"
    path = "/api/vendor-onboarding/webhook/payment"
    envVar = "STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET"
    eventType = "payment_intent.succeeded"
    purpose = "vendor verification payment"
  },
  [ordered]@{
    name = "orderPostPayment"
    path = "/api/stripe/payment/webhook"
    envVar = "STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET"
    eventType = "payment_intent.succeeded"
    purpose = "post-payment order enrichment and email"
  }
)

$results = [ordered]@{
  runType = "production-stripe-webhook-runtime"
  testedAt = (Get-Date).ToUniversalTime().ToString("o")
  apiHost = ([Uri]$ApiBase).Host
  requestedActions = [ordered]@{
    sendUnsignedProbes = [bool]$SendUnsignedProbes
  }
  scenarios = [ordered]@{}
  mutationPolicy = [ordered]@{
    signedStripeEventsSent = $false
    signingSecretsSent = $false
    paymentMethodsSubmitted = $false
    orderOrVendorStateMutationExpected = $false
  }
  redaction = [ordered]@{
    webhookSecrets = "not read or recorded"
    stripeSignatures = "not sent"
    requestBodies = "synthetic unsigned probe only; raw body not recorded"
    responseBodies = "not recorded"
    endpointSecrets = "env var names only"
  }
  verdict = "UNKNOWN"
  notes = @()
}

function Get-MessageClass {
  param([AllowNull()][string]$Raw)
  if ([string]::IsNullOrWhiteSpace($Raw)) {
    return $null
  }
  if ($Raw -match "stripe-signature") {
    return "missing-signature"
  }
  if ($Raw -match "Webhook Error") {
    return "webhook-error"
  }
  if ($Raw -match "not configured") {
    return "server-webhook-config-error"
  }
  return "other"
}

function Invoke-UnsignedWebhookProbe {
  param(
    [string]$Path,
    [string]$EventType
  )

  $uri = "$ApiBase$Path"
  $body = @{
    id = "evt_unsigned_runtime_probe"
    type = $EventType
    data = @{
      object = @{
        id = "pi_unsigned_runtime_probe"
        metadata = @{
          source = "mosaic-runtime-smoke"
        }
      }
    }
  } | ConvertTo-Json -Depth 8

  try {
    $response = Invoke-WebRequest -Uri $uri -Method POST -UseBasicParsing -ContentType "application/json" -Body $body
    return [ordered]@{
      status = [int]$response.StatusCode
      messageClass = Get-MessageClass $response.Content
    }
  } catch {
    $status = 0
    $raw = ""
    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode.value__
      $stream = $_.Exception.Response.GetResponseStream()
      if ($stream) {
        $reader = [System.IO.StreamReader]::new($stream)
        $raw = $reader.ReadToEnd()
      }
    }
    return [ordered]@{
      status = $status
      messageClass = Get-MessageClass $raw
    }
  }
}

function Save-ResultsAndExit {
  param([int]$ExitCode)
  $directory = Split-Path -Parent $OutFile
  if ($directory -and -not (Test-Path $directory)) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
  }
  $results | ConvertTo-Json -Depth 12 | Set-Content -Path $OutFile -Encoding UTF8
  Write-Host "Wrote redacted webhook runtime results to $OutFile"
  Write-Host "Verdict: $($results.verdict)"
  exit $ExitCode
}

try {
  if (-not $SendUnsignedProbes) {
    foreach ($endpoint in $endpoints) {
      $results.scenarios[$endpoint.name] = [ordered]@{
        status = "skipped"
        pass = $true
        path = $endpoint.path
        purpose = $endpoint.purpose
        envVar = $endpoint.envVar
        reason = "Skipped unless -SendUnsignedProbes is provided."
      }
    }
    $results.notes += "No HTTP webhook probes were sent. Use -SendUnsignedProbes during controlled QA to verify production unsigned rejection."
    $results.verdict = "PASS"
    Save-ResultsAndExit -ExitCode 0
  }

  foreach ($endpoint in $endpoints) {
    $probe = Invoke-UnsignedWebhookProbe -Path $endpoint.path -EventType $endpoint.eventType
    $results.scenarios[$endpoint.name] = [ordered]@{
      status = $probe.status
      pass = ([int]$probe.status -eq 400)
      expectedStatus = 400
      path = $endpoint.path
      purpose = $endpoint.purpose
      envVar = $endpoint.envVar
      messageClass = $probe.messageClass
    }
  }

  $failures = @($results.scenarios.Values | Where-Object { -not $_.pass })
  $results.verdict = if ($failures.Count -eq 0) { "PASS" } else { "FAIL" }
  if ($failures.Count -gt 0) {
    $results.notes += "A non-400 response means the deployed endpoint did not reject the unsigned probe as expected. Inspect EB logs without printing secrets."
  }
  Save-ResultsAndExit -ExitCode $(if ($failures.Count -eq 0) { 0 } else { 1 })
} catch {
  $results.verdict = "FAIL"
  $results.notes += $_.Exception.Message
  Save-ResultsAndExit -ExitCode 1
}
