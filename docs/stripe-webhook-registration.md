# Stripe Webhook Registration Guide

The Mosaic Biz Hub backend exposes **five** Stripe webhook endpoints with **distinct** signing secrets. Each endpoint must be registered in the Stripe Dashboard (Live mode for production, Test mode for local/dev) and its `whsec_...` value stored in the matching environment variable.

Base URL for production: **`https://api.mosaicbizhub.com`**

---

## Endpoint map

| # | HTTP route | Env variable | Purpose |
|---|------------|--------------|---------|
| 1 | `POST /api/webhooks/stripe` | `STRIPE_ORDER_WEBHOOK_SECRET` | Canonical order payment status updates |
| 2 | `POST /api/stripe/webhook` | `STRIPE_BUSINESS_DRAFT_WEBHOOK_SECRET` | Business draft Checkout completion; Connect account sync |
| 3 | `POST /api/subscription/webhook` | `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` | Subscription billing lifecycle |
| 4 | `POST /api/vendor-onboarding/webhook/payment` | `STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET` | Vendor Stage-1 $24.99 verification PaymentIntent |
| 5 | `POST /api/stripe/payment/webhook` | `STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET` | Post-payment order emails |

---

## Registration steps (Stripe Dashboard)

For **each** row above:

1. Open [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks).
2. Click **Add endpoint**.
3. Enter endpoint URL: `https://api.mosaicbizhub.com` + route path (e.g. `https://api.mosaicbizhub.com/api/webhooks/stripe`).
4. Select events (minimum recommended):

| Route | Suggested events |
|-------|------------------|
| `/api/webhooks/stripe` | `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded` (confirm against `webhookController.js`) |
| `/api/stripe/webhook` | `checkout.session.completed`, `account.updated` (confirm against `stripeController.js`) |
| `/api/subscription/webhook` | `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted` |
| `/api/vendor-onboarding/webhook/payment` | `payment_intent.succeeded` (verification PI metadata) |
| `/api/stripe/payment/webhook` | `payment_intent.succeeded` (order email path) |

5. After creating the endpoint, reveal **Signing secret** (`whsec_...`).
6. Set the corresponding env var in AWS EB (see [production-env-checklist.md](production-env-checklist.md)).
7. Redeploy/restart EB so the new secret is loaded.
8. Use **Send test webhook** in Dashboard; confirm HTTP 200 and no signature errors in EB logs. Use [qa/PRODUCTION_STRIPE_WEBHOOK_RUNTIME_SMOKE_RUNBOOK_2026_06_28.md](qa/PRODUCTION_STRIPE_WEBHOOK_RUNTIME_SMOKE_RUNBOOK_2026_06_28.md) for the current redacted runtime proof format.

---

## Local development

Use Stripe CLI or Dashboard test mode:

```bash
stripe listen --forward-to localhost:3001/api/webhooks/stripe
```

Copy the CLI signing secret into `.env` as the matching `STRIPE_*_WEBHOOK_SECRET`. Repeat for each route or use separate CLI listeners per endpoint.

Local `.env` must be named **`.env`** (not `.env.local`) — see [SETUP.md](../SETUP.md).

---

## Common failures

| Symptom | Likely cause |
|---------|--------------|
| 400 signature verification failed | Wrong `whsec` for that route; or JSON body parsed before webhook (must stay before `express.json()` in `app.js`) |
| Webhook never fires | URL typo; live vs test mode mismatch; endpoint not registered |
| Order paid in Stripe but DB still pending | Wrong webhook (#1 vs #5); check which handler updates `paymentStatus` |

---

## Verification checklist

- [ ] All 5 endpoints registered in Stripe Dashboard (Live for production)
- [ ] Each `STRIPE_*_WEBHOOK_SECRET` set in EB and matches Dashboard signing secret
- [ ] Test delivery succeeds for each endpoint (screenshot for proof pack — redact secrets)
- [ ] Vendor verification PI success updates onboarding payment status
- [ ] Test order payment updates order `paymentStatus` via route #1

Record results in [production-proof-pack-template.md](production-proof-pack-template.md).
For current launch QA, also attach the redacted status-only output described in [qa/PRODUCTION_STRIPE_WEBHOOK_RUNTIME_SMOKE_RUNBOOK_2026_06_28.md](qa/PRODUCTION_STRIPE_WEBHOOK_RUNTIME_SMOKE_RUNBOOK_2026_06_28.md).
