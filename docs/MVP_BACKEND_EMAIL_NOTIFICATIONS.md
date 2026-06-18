# MVP Backend Email Notifications (Issue #33)

**Branch:** `sprint/backend-deploy-smoke-sentry-18-27` (Batch 3 sync)  
**Status:** Audit + tests + docs — **#43 closed on `main` (PR #78)**  
**Program hub:** [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md)

**Related:** [MVP_BACKEND_VENDOR_ONBOARDING_EMAIL_FLOW.md](MVP_BACKEND_VENDOR_ONBOARDING_EMAIL_FLOW.md) (issue #30 onboarding emails)

---

## Purpose

Audit and document launch-safe backend email notification behavior for vendor onboarding, order confirmation, and review follow-up readiness. Add tests proving graceful SMTP failure handling and logging safety without faking delivery.

**Principle:** Do not fake email delivery. When SMTP is missing or send fails, core HTTP flows still succeed unless the existing contract intentionally requires failure (e.g. forgot-password).

---

## Scope boundaries

| Topic | Owner issue | #33 action |
| --- | --- | --- |
| Vendor onboarding emails (#30) | #30 | Preserve + test submit path |
| Order confirmation **timing** (pre-payment vs post-payment) | #43 | **Resolved on `main`** — paid confirmation webhook-only via `paidConfirmationEmailSentAt` |
| Webhook email dedup on retry | #43 | **Resolved on `main`** — dedup flag prevents resend on Stripe retry |
| Post-purchase review follow-up | #35 | Document gap — not implemented |
| Stripe/payment/webhook architecture | #32 / #43 | No changes |

---

## Audited files and routes

### Mail utilities

| File | Functions | Domain |
| --- | --- | --- |
| [`utils/mailer.js`](../utils/mailer.js) | `sendOtpEmail`, `sendPasswordResetOtpEmail`, `sendWelcomeEmail` | Auth |
| [`utils/WellcomeMailer.js`](../utils/WellcomeMailer.js) | Onboarding submit/approve/reject/badge, admin alerts | Vendor onboarding |
| [`utils/vendorOnboardingEmailDelivery.js`](../utils/vendorOnboardingEmailDelivery.js) | `deliverVendorOnboardingEmail(s)` | Graceful SMTP gate |
| [`utils/OrderMail.js`](../utils/OrderMail.js) | `sendOrderPaidEmails` | Post-payment confirmation + PDF invoice |
| [`utils/orderPhase.js`](../utils/orderPhase.js) | Placed, accept/reject, shipped, delivered | Order lifecycle |
| [`utils/approvalMail.js`](../utils/approvalMail.js) | Business approved/blocked/deactivated | Business admin |
| [`utils/bookingMailer.js`](../utils/bookingMailer.js) | Service booking lifecycle | Bookings |
| [`utils/BuisnessprofileMail.js`](../utils/BuisnessprofileMail.js) | Business profile admin review | Legacy profile flow |

### Controllers with email triggers (primary #33 focus)

| Controller | Route / trigger | Email type |
| --- | --- | --- |
| [`vendorOnboarding.controller.js`](../controllers/vendorOnboarding.controller.js) | `POST /api/vendor-onboarding/submit` | Admin + vendor submission receipt |
| [`admin/vendorOnboardVerifyStage1.js`](../controllers/admin/vendorOnboardVerifyStage1.js) | `POST /api/vendor-onboarding/:id/finalize` | Approve / reject / badge |
| [`orderController.js`](../controllers/orderController.js) | `POST /api/orders/initiate`, accept/reject/ship/deliver | Order placed + lifecycle |
| [`stripePaymentController.js`](../controllers/stripePaymentController.js) | `POST /api/stripe/payment/webhook` | Order paid + invoice |

### Environment variables (names only — never commit values)

| Variable | Used for |
| --- | --- |
| `MAIL_USER` | SMTP auth + from address |
| `MAIL_PASSWORD` | SMTP auth (Gmail app password) |
| `ADMIN_EMAIL` | Admin notification recipients |
| `SUPPORT_EMAIL` | Order mail support line fallback |
| `APP_NAME` | Order phase subject branding |
| `APP_URL` | Order mail links |
| `FRONTEND_URL` | Approval mail + template links |

---

## Supported email types

| Category | Trigger | Template / helper | Failure behavior |
| --- | --- | --- | --- |
| Vendor submission receipt | `submitForReview` | `sendVendorSubmissionConfirmationEmail` | Non-blocking; `emailSent` / `emailSkipped` on response |
| Admin submission alert | `submitForReview` | `sendAdminOnboardingSubmissionEmail` | Same delivery helper |
| Vendor approved | `finalizeVerification` | `sendVendorApprovedEmail` | Non-blocking; HTTP 200 |
| Vendor rejected | `finalizeVerification` | `sendVendorRejectionEmail` | Non-blocking; HTTP 200 |
| Trust badge assigned | `finalizeVerification` | `sendVendorTrustBadgeAssignedEmail` | Non-blocking; HTTP 200 |
| Order placed (customer) | `initiateOrder` | `sendCustomerOrderPlacedEmail` | try/catch; order + PI still created |
| Order placed (vendor) | `initiateOrder` | `sendVendorNewOrderEmail` | try/catch; order + PI still created |
| Order paid + invoice | `payment_intent.succeeded` webhook | `sendOrderPaidEmails` | try/catch per order; webhook 200 |
| Order accepted/rejected | accept/reject handlers | `sendOrderStatusEmail` | try/catch; order update succeeds |
| Order shipped/delivered | ship/deliver handlers | `sendOrderUpdateEmail` | try/catch; order update succeeds |

### Vendor submission receipt copy (#33)

> Thank you for applying to Mosaic Biz Hub. Your information is under review. We'll email next steps within **3–5 business days**.

Application ID and support contact are included. Approve/reject/badge templates from #30 are unchanged.

---

## Unsupported / deferred email types

| Type | Status | Tracked in |
| --- | --- | --- |
| Post-purchase review follow-up | **Not implemented** — Review CRUD exists (`reviewController.js`) but no mailer, scheduler, or post-order hook | #35 |
| Move **paid** confirmation to post-payment only | **Done (#43)** — `sendOrderPaidEmails` webhook-only; dedup via `paidConfirmationEmailSentAt` | Closed |
| Pre-payment "order placed" emails at `initiateOrder` | **Still active** — `sendCustomerOrderPlacedEmail` / `sendVendorNewOrderEmail` at order create | Documented P0-6 risk |
| Webhook email dedup on retry | **Done (#43)** — skip when `paidConfirmationEmailSentAt` set | Closed |
| Food booking emails | **Not implemented** | — |
| Unified mail service / retry queue | **Not implemented** | — |

---

## Failure behavior matrix

| Flow | Missing SMTP | Send throws | HTTP outcome |
| --- | --- | --- | --- |
| Vendor submit / finalize | Skip + warn | Log message only | **200** — state persisted |
| `initiateOrder` emails | N/A (no gate) | Log `err.message` | **201** — order + PI created |
| Post-payment webhook emails | N/A | Log `mailErr.message` | **200** — webhook ack |
| Order accept/reject/ship/deliver | N/A | Log message | **200** — order updated |
| Register OTP | N/A | Log; registration succeeds | **200/201** |
| Forgot password OTP | N/A | Log; returns error | **500** — intentional contract |

---

## Logging safety

- [`vendorOnboardingEmailDelivery.js`](../utils/vendorOnboardingEmailDelivery.js): logs label + `err.message` only; never OTP, credentials, or full payloads
- Order email catch blocks (#33): log `err?.message` / `mailErr?.message` only
- `mailer.js`: OTP values are not logged (verified by automated source audit)

---

## Tests

| File | Tests | Coverage |
| --- | ---: | --- |
| [`tests/admin/vendor-onboarding-finalize.test.js`](../tests/admin/vendor-onboarding-finalize.test.js) | 5 | Approve/reject + SMTP skip/failure (#30) |
| [`tests/vendor/vendor-onboarding-submit-email.test.js`](../tests/vendor/vendor-onboarding-submit-email.test.js) | 4 | Submit email flags, skip, failure, idempotent |
| [`tests/utils/vendor-onboarding-email-delivery.test.js`](../tests/utils/vendor-onboarding-email-delivery.test.js) | 6 | Delivery helper unit tests |
| [`tests/email/email-notification-safety.test.js`](../tests/email/email-notification-safety.test.js) | 4 | Review gap audit, OTP/logging source checks |
| [`tests/stripe/order-email-safety.test.js`](../tests/stripe/order-email-safety.test.js) | 3 | Post-payment email call + safe failure |

**Suite total (Batch 3):** **190/190** (`npm test`) — includes #43 order-email-safety tests

**Not proven by automation:** Live SMTP inbox delivery, template rendering in real clients, PDF invoice attachment in production.

---

## Smoke test plan (`SMOKE_TEST_*` accounts only)

Live SMTP inbox proof requires **disposable dedicated smoke accounts** — not automated in CI.

| Tier | Scenario | Accounts | Expected |
| --- | --- | --- | --- |
| C1 | Vendor submit → receipt email | `SMOKE_TEST_VENDOR_*` | Inbox: submission receipt (3–5 business day copy) |
| C2 | Admin finalize approve | `SMOKE_TEST_ADMIN_*` + pending vendor app | Inbox: approval email; API `emailSent: true` |
| C3 | Admin finalize reject | Same | Inbox: rejection email |
| B1 | Checkout → order paid email | `SMOKE_TEST_CUSTOMER_*` + vendor listing | Inbox: payment confirmation + invoice PDF |
| B2 | Order placed (pre-payment) | Same | Inbox: placed email (document P0-6 timing risk) |

**Blockers:** `SMOKE_TEST_*` accounts not provisioned in repo — all live inbox proof **PENDING**.

---

## Remaining risks

| Risk | Detail |
| --- | --- |
| Pre-payment order emails | Customer may receive "order placed" before payment succeeds — **not changed by #43** |
| Paid confirmation dedup | **Mitigated (#43)** — `paidConfirmationEmailSentAt` on webhook |
| No review follow-up | Post-purchase review prompt not implemented — #35 |
| Fragmented mailers | 8+ files each create own Nodemailer transport |
| Live SMTP unverified | Production inbox proof not captured |

---

## Related documentation

- [MVP_BACKEND_VENDOR_ONBOARDING_EMAIL_FLOW.md](MVP_BACKEND_VENDOR_ONBOARDING_EMAIL_FLOW.md)
- [TEST_MATRIX.md](TEST_MATRIX.md)
- [deploy-verification.md](deploy-verification.md)
- [MVP_BACKEND_API_AUDIT.md](MVP_BACKEND_API_AUDIT.md) §5 gaps

---

## Batch 3 — Issue #67 resolution (2026-06-18)

| AC | Status | Evidence |
| --- | --- | --- |
| Template + trigger inventory | **Complete** | Tables above + mail utility file list |
| #43 payment timing alignment | **Synced** | Paid emails webhook-only; dedup documented |
| No payment timing regression | **Verified** | No changes to webhook or initiateOrder paths in Batch 3 |
| Test coverage | **190/190** | Includes `tests/stripe/order-email-safety.test.js`, vendor email tests |

Close #67 with this doc as the canonical email inventory. Remaining quality work (unified mailer, review follow-up #35) stays post-launch.
