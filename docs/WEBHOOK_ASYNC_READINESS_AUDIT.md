# Webhook Async Readiness Audit (Issue #59)

**Date:** 2026-06-18  
**Branch:** `sprint/backend-deploy-smoke-sentry-18-27`

---

## Purpose

Inventory synchronous work inside Stripe webhook handlers. Document queue options for future async processing — **no implementation in Batch 3**.

---

## Webhook endpoints

| Path | Handler | Secret env var |
| --- | --- | --- |
| `POST /api/stripe/payment/webhook` | `stripePaymentController.stripePaymentWebhook` | `STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET` |
| `POST /api/vendor-onboarding/webhook/payment` | `handleVendorPaymentWebhook` | `STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET` |
| `POST /api/subscription/webhook` | `handleSubscriptionWebhook` | `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` |

All mounted with raw body in [`app.js`](../app.js) before JSON parser.

---

## Sync work inventory

### Order payment webhook ([`stripePaymentController.js`](../controllers/stripePaymentController.js))

| Step | Sync? | Duration risk |
| --- | --- | --- |
| Signature verify | Yes | Low |
| `Order.find({ paymentId }).populate(...)` | Yes | Medium (multi populate) |
| `stripe.charges.retrieve(chargeId)` | Yes | **High** — external API per event |
| Per-order `order.save()` | Yes | Medium |
| `sendOrderPaidEmails()` (PDF + SMTP) | Yes | **High** — can exceed Stripe 30s timeout on retry storms |
| Dedup via `paidConfirmationEmailSentAt` | Yes | Mitigates duplicate email, not latency |

**Failure mode:** Handler returns 500 → Stripe retries → mitigated for email by dedup flag; charge fetch still runs each retry.

### Vendor verification webhook ([`vendorOnboarding.controller.js`](../controllers/vendorOnboarding.controller.js))

| Step | Sync? | Notes |
| --- | --- | --- |
| Signature verify | Yes | |
| Update `VendorOnboardingStage1` payment fields | Yes | Single doc update |
| Status transition to `draft` + `paid` | Yes | No email in webhook path |

Lower latency risk than order webhook.

### Subscription webhook ([`webhookController.js`](../controllers/webhookController.js))

| Step | Sync? | Notes |
| --- | --- | --- |
| Signature verify | Yes | |
| Subscription CRUD by event type | Yes | Multiple event branches |
| Stripe API follow-up calls | Varies | Depends on event |

Review full handler before async migration — invoice/payment_failed paths may call Stripe.

---

## Current reliability patterns

| Pattern | Where |
| --- | --- |
| Fast 200 after idempotent no-op | Order webhook when no orders match `paymentId` |
| Best-effort email (try/catch) | Order paid — webhook still 200 if mail fails |
| Email dedup flag | `paidConfirmationEmailSentAt` (#43) |
| Raw body preservation | Signature validation |

**Missing:** Job queue, webhook event idempotency store, dead-letter queue.

---

## Queue options (doc-only)

| Option | Pros | Cons |
| --- | --- | --- |
| **BullMQ + Redis** | Mature, retries, visibility | New infra on EB |
| **SQS + Lambda/worker** | AWS-native, scales | Split deploy complexity |
| **In-process setImmediate** | Minimal change | No durability on crash |
| **Stripe webhook endpoint timeout + fast ack** | Standard pattern | Requires durable queue for side effects |

**Recommended future path:** Ack webhook within 5s → enqueue `{ eventId, type, payloadRef }` → worker processes order update, charge fetch, email.

---

## Migration checklist (deferred)

1. Add `ProcessedStripeEvent` collection keyed by `event.id` for idempotency.
2. Move `sendOrderPaidEmails` and PDF generation to queue consumer.
3. Move `stripe.charges.retrieve` to worker (or cache charge on PI metadata).
4. Keep signature verification synchronous on webhook route.
5. Load test with Stripe CLI replay.

---

## Issue #59 status

**Partial progress** — sync inventory and queue recommendations documented. Implementation deferred post-launch.
