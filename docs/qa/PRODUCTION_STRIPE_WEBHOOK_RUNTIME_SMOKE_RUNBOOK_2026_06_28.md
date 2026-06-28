# Production Stripe Webhook Runtime Smoke Runbook - 2026-06-28

Related launch tracker:

- Frontend #250 Cross-repo soft-launch backend and Stripe verification tracker
- Backend #151 isolated launch access integration tests
- Backend #155 route authorization matrix and negative-access contract tests

## Purpose

Use this runbook to verify the deployed Mosaic Biz Hub backend webhook boundary before live Stripe keys.

This is a no-code-change verification lane. It does not change payment, checkout, Connect, subscription, or webhook behavior.

## What Exists

Automated coverage already verifies:

- all Stripe webhook mounts are registered before `express.json()`
- webhook routes use `express.raw()` where required
- each route uses its own signing secret environment variable
- missing or invalid signatures reject
- canonical order webhook rejects parsed JSON bodies

Primary automated test:

```powershell
npm test -- --test-name-pattern webhook
```

If the package runner does not forward the pattern in your shell, run the focused file directly:

```powershell
node --test tests/stripe/stripe-webhook-routing-signature.test.js
```

## Script

```powershell
scripts/production-stripe-webhook-runtime-smoke.ps1
```

Default output:

```text
docs/qa-redacted/production-stripe-webhook-runtime-2026-06-28/stripe-webhook-runtime-redacted-results.json
```

Commit only reviewed redacted output. Do not commit Stripe Dashboard screenshots unless secrets, signatures, event payload details, customer data, and payment details are removed.

## Endpoint Map

| Route | Env var | Purpose |
| --- | --- | --- |
| `POST /api/webhooks/stripe` | `STRIPE_ORDER_WEBHOOK_SECRET` | Canonical order payment status |
| `POST /api/stripe/webhook` | `STRIPE_BUSINESS_DRAFT_WEBHOOK_SECRET` | Business draft checkout and Connect account sync |
| `POST /api/subscription/webhook` | `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` | Subscription billing lifecycle |
| `POST /api/vendor-onboarding/webhook/payment` | `STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET` | Vendor verification payment |
| `POST /api/stripe/payment/webhook` | `STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET` | Post-payment order enrichment and email |

## Validation Only

This parses the script without sending HTTP requests.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\production-stripe-webhook-runtime-smoke.ps1 -ValidateOnly
```

## Dry Run

This writes a redacted skipped-results file without sending webhook probes.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\production-stripe-webhook-runtime-smoke.ps1
```

Validate the dry-run output shape and redaction only:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-production-stripe-webhook-runtime-evidence.ps1 -AllowDryRun
```

## Unsigned Rejection Runtime Proof

Run this during controlled QA only. It sends five synthetic unsigned POST requests to production and expects HTTP `400` from every webhook route.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\production-stripe-webhook-runtime-smoke.ps1 -SendUnsignedProbes
```

Expected result:

- all five routes return `400`
- output records route names, statuses, expected status, and message class only
- no signing secret is read or sent
- no Stripe signature is sent
- no payment method is submitted
- no real Stripe event is sent
- no order, vendor, subscription, or email mutation is expected

Validate the unsigned runtime evidence before summarizing it in GitHub:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-production-stripe-webhook-runtime-evidence.ps1
```

If any route returns `200`, `404`, `500`, or `0`, stop and inspect EB logs without printing secrets. A `500` can indicate missing webhook env configuration. A `404` can indicate route/mount drift. A `200` would indicate signature enforcement is not behaving as expected.

## Valid Stripe Delivery Proof

Unsigned rejection does not prove Stripe Dashboard delivery. Before live keys, run valid test-mode delivery separately from Stripe Dashboard or Stripe CLI.

Minimum proof required:

1. Confirm each Dashboard endpoint is registered in Stripe test mode against `https://api.mosaicbizhub.com`.
2. Confirm each endpoint uses the matching signing secret env var in EB.
3. Send a test webhook for each endpoint.
4. Confirm HTTP `200` for valid signed delivery.
5. Confirm EB logs do not show signature errors for valid delivery.
6. For order checkout, confirm a test-mode order PaymentIntent drives the expected order status transition.
7. For post-payment email path, confirm no duplicate email corruption on retry.

Do not paste or commit:

- `whsec_...` values
- `sk_...` values
- raw event payloads
- Stripe signatures
- raw PaymentIntent IDs unless the release owner explicitly approves a redacted proof format
- customer email, phone, address, card, or payment details

Allowed evidence:

- endpoint route
- event type
- HTTP status
- timestamp
- Stripe mode: test or live
- redacted screenshot with endpoint ID/event ID hidden or hashed
- EB log line summary with secrets and IDs removed
- order/status labels without private customer data

The validator above proves only redacted unsigned-rejection smoke output. Valid Stripe Dashboard or Stripe CLI delivery still requires the manual signed-delivery proof in this section.

## Stop Conditions

Stop and open a blocker if:

- any live-mode event is sent before written live-key approval
- any webhook secret or Stripe API key appears in terminal output, screenshots, docs, commits, or GitHub comments
- unsigned probes return `200`
- valid Stripe test-mode delivery returns non-200 for a correctly registered endpoint
- EB logs show repeated signature verification failures for valid test deliveries
- an order reaches paid/ordered state outside Stripe test mode

## Evidence Comment Template

Use this for the frontend #250 tracker and backend PR comments after a reviewed run:

```markdown
Stripe webhook runtime smoke evidence, 2026-06-28:
- Backend repo/branch: Techware-Hut/mosaic-backend `staging`
- Script: `scripts/production-stripe-webhook-runtime-smoke.ps1`
- Mode: dry run / `-SendUnsignedProbes` / valid Dashboard delivery
- Output: `docs/qa-redacted/production-stripe-webhook-runtime-2026-06-28/stripe-webhook-runtime-redacted-results.json`
- Unsigned rejection: PASS/FAIL
- Valid Stripe test-mode delivery: PASS/FAIL/NOT RUN
- Secrets/signatures/raw payloads recorded: no
- Live-mode events sent: no
- Follow-up blockers:
```
