# MVP Backend Email Notifications (Issue #33)

**Branch:** `sprint/backend-deploy-smoke-sentry-18-27` (Batch 3 sync)  
**Status:** Audit + tests + docs — **#43 closed on `main` (PR #78)**  
**Program hub:** [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md)

**Related:** [MVP_BACKEND_VENDOR_ONBOARDING_EMAIL_FLOW.md](MVP_BACKEND_VENDOR_ONBOARDING_EMAIL_FLOW.md) (issue #30 onboarding emails)

---

## Purpose

Audit and document launch-safe backend email notification behavior for vendor onboarding, order confirmation, and review follow-up readiness. Add tests proving graceful SMTP failure handling and logging safety without faking delivery.

**Principle:** Do not fake email delivery. When SMTP is missing or send fails, registration/resend/unverified-login OTP flows return **502** `OTP_DELIVERY_FAILED` after persisting the unverified account/OTP hash. Forgot-password stays anti-enumeration safe and returns the same generic **200** response on send failure. Vendor onboarding skips sends when env is missing.

---

## Scope boundaries

| Topic | Owner issue | #33 action |
| --- | --- | --- |
| Vendor onboarding emails (#30) | #30 | Preserve + test submit path |
| Customer order lifecycle emails | #182 | Added best-effort customer emails for real order status changes with `lifecycleEmailLog` audit evidence |
| Order confirmation **timing** (pre-payment vs post-payment) | #43 | **Resolved on `main`** — paid confirmation webhook-only via `paidConfirmationEmailSentAt` |
| Webhook email dedup on retry | #43 | **Resolved on `main`** — dedup flag prevents resend on Stripe retry |
| Post-purchase review follow-up | #35 | Document gap — not implemented |
| Stripe/payment/webhook architecture | #32 / #43 | No changes |

---

## Audited files and routes

### Mail utilities

| File | Functions | Domain |
| --- | --- | --- |
| [`utils/smtpTransport.js`](../utils/smtpTransport.js) | Provider-neutral SMTP config + Gmail fallback | Auth and transactional mail |
| [`utils/mailer.js`](../utils/mailer.js) | `sendOtpEmail`, `sendPasswordResetOtpEmail`, `sendWelcomeEmail` | Auth |
| [`utils/WellcomeMailer.js`](../utils/WellcomeMailer.js) | Onboarding submit/approve/reject/badge, admin alerts | Vendor onboarding |
| [`utils/vendorOnboardingEmailDelivery.js`](../utils/vendorOnboardingEmailDelivery.js) | `deliverVendorOnboardingEmail(s)` | Graceful SMTP gate |
| [`utils/OrderMail.js`](../utils/OrderMail.js) | `sendOrderPaidEmails` | Post-payment confirmation + PDF invoice |
| [`utils/orderPhase.js`](../utils/orderPhase.js) | Accept/reject, shipped/delivered, cancel/return/refund templates | Order lifecycle |
| [`utils/orderLifecycleEmailDelivery.js`](../utils/orderLifecycleEmailDelivery.js) | `sendCustomerOrderLifecycleEmail`, `lifecycleEmailLog` append/dedup helpers | Order lifecycle audit |
| [`utils/approvalMail.js`](../utils/approvalMail.js) | Business approved/blocked/deactivated | Business admin |
| [`utils/bookingMailer.js`](../utils/bookingMailer.js) | Service booking lifecycle | Bookings |
| [`utils/BuisnessprofileMail.js`](../utils/BuisnessprofileMail.js) | Business profile admin review | Legacy profile flow |

### Controllers with email triggers (primary #33 focus)

| Controller | Route / trigger | Email type |
| --- | --- | --- |
| [`vendorOnboarding.controller.js`](../controllers/vendorOnboarding.controller.js) | `POST /api/vendor-onboarding/submit` | Admin + vendor submission receipt |
| [`admin/vendorOnboardVerifyStage1.js`](../controllers/admin/vendorOnboardVerifyStage1.js) | `POST /api/vendor-onboarding/:id/finalize` | Approve / reject / badge |
| [`orderController.js`](../controllers/orderController.js) | accept/reject/ship/deliver/cancel/initiate-return/accept-return | Customer order lifecycle |
| [`stripePaymentController.js`](../controllers/stripePaymentController.js) | `POST /api/stripe/payment/webhook` | Order paid + invoice |
| [`userController.js`](../controllers/userController.js) | `POST /api/users/register`, `/resend-otp`, unverified `/login` | Registration / resend / login OTP |

### Auth OTP delivery failure contract

| Endpoint | On SMTP success | On SMTP failure after DB save |
| --- | --- | --- |
| `POST /api/users/register` | **201** — OTP sent to email; `otpPending` cookie | **502** `OTP_DELIVERY_FAILED` — account saved; `otpPending` cookie |
| `POST /api/users/resend-otp` | **200** — OTP resent; `otpPending` cookie | **502** `OTP_DELIVERY_FAILED` — new OTP hash saved; no cookie |
| `POST /api/users/login` (unverified) | **403** `otpPending: true` — OTP emailed | **502** `OTP_DELIVERY_FAILED` — no session/cookie |
| `POST /api/users/forgot-password` | **200** generic anti-enumeration response | **200** same generic response; sanitized log only |

**SMTP setup:** `MAIL_USER` + `MAIL_PASSWORD` are required. When `MAIL_HOST` is unset, transactional mail uses the existing Gmail fallback. When `MAIL_HOST` is set, transactional mail uses `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURE`, and `MAIL_FROM` for provider-neutral SMTP.

**Production inbox smoke (auth OTP):** Register with a disposable inbox; confirm delivery or **502** + log grep for `Auth OTP email delivery failed` and sanitized code/response-code markers. Never log OTP values or `MAIL_PASSWORD`.

### Environment variables (names only — never commit values)

| Variable | Used for |
| --- | --- |
| `MAIL_USER` | SMTP auth + from address |
| `MAIL_PASSWORD` | SMTP auth password/app password |
| `MAIL_HOST` | Optional provider-neutral transactional SMTP host |
| `MAIL_PORT` | Optional provider-neutral transactional SMTP port |
| `MAIL_SECURE` | Optional provider-neutral transactional SMTP TLS flag |
| `MAIL_FROM` | Optional provider-neutral transactional mail From header |
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
| Vendor correction/clarification guidance | `sendVerificationGuidanceNotification` | `sendVendorVerificationGuidanceEmail` | Non-blocking; dedupes identical status/reason payloads |
| Trust badge assigned | `finalizeVerification` | `sendVendorTrustBadgeAssignedEmail` | Non-blocking; HTTP 200 |
| Pre-payment order placed (customer) | `initiateOrder` | Legacy helper only; not called by active order controller | No email before payment succeeds |
| Pre-payment order placed (vendor) | `initiateOrder` | Legacy helper only; not called by active order controller | No email before payment succeeds |
| Order paid + invoice | `payment_intent.succeeded` webhook | `sendOrderPaidEmails` | try/catch per order; webhook 200 |
| Order accepted/rejected | accept/reject handlers | `sendOrderStatusEmail` via lifecycle helper | Best-effort; state persists and attempt is logged |
| Order shipped/delivered | ship/deliver handlers | `sendOrderUpdateEmail` via lifecycle helper | Best-effort; state persists and attempt is logged |
| Order cancelled / return initiated / refunded | cancel/initiate-return/accept-return handlers | `sendOrderLifecycleEmail` via lifecycle helper | Best-effort; state persists and attempt is logged |

### Vendor submission receipt copy (#33)

> Thank you for applying to Mosaic Biz Hub. Your information is under review. We'll email next steps within **3–5 business days**.

Application ID and support contact are included. Approve/reject/badge templates from #30 are unchanged.

---

## Unsupported / deferred email types

| Type | Status | Tracked in |
| --- | --- | --- |
| Post-purchase review follow-up | **Not implemented** — Review CRUD exists (`reviewController.js`) but no mailer, scheduler, or post-order hook | #35 |
| Move **paid** confirmation to post-payment only | **Done (#43)** — `sendOrderPaidEmails` webhook-only; dedup via `paidConfirmationEmailSentAt` | Closed |
| Pre-payment "order placed" emails at `initiateOrder` | **Disabled in active controller** - legacy helpers remain exported but are not called from `initiateOrder` | Closed by #43/#182 |
| Webhook email dedup on retry | **Done (#43)** — skip when `paidConfirmationEmailSentAt` set | Closed |
| Food booking emails | **Not implemented** | — |
| Unified mail service / retry queue | **Not implemented** | — |

---

## Failure behavior matrix

| Flow | Missing SMTP | Send throws | HTTP outcome |
| --- | --- | --- | --- |
| Vendor submit / finalize | Skip + warn | Log message only | **200** — state persisted |
| `initiateOrder` pre-payment emails | Not sent | Not applicable | **201** - order + PI created; paid email waits for webhook |
| Post-payment webhook emails | N/A | Log `mailErr.message` | **200** — webhook ack |
| Order lifecycle handlers | N/A | Log message + append `lifecycleEmailLog` entry | **200** - order state persisted |
| Register OTP | N/A | Log sanitized code; account preserved | **502** `OTP_DELIVERY_FAILED` |
| Forgot password OTP | N/A | Log sanitized code; generic response | **200** — anti-enumeration |

---

## Logging safety

- [`vendorOnboardingEmailDelivery.js`](../utils/vendorOnboardingEmailDelivery.js): logs label + `err.message` only; never OTP, credentials, or full payloads
- Order email catch blocks (#33): log `err?.message` / `mailErr?.message` only
- Auth OTP delivery logs sanitized code/type details only; no raw provider payloads, OTP values, or credentials (verified by automated source audit)

---

## Tests

| File | Tests | Coverage |
| --- | ---: | --- |
| [`tests/admin/vendor-onboarding-finalize.test.js`](../tests/admin/vendor-onboarding-finalize.test.js) | 5 | Approve/reject + SMTP skip/failure (#30) |
| [`tests/vendor/vendor-onboarding-submit-email.test.js`](../tests/vendor/vendor-onboarding-submit-email.test.js) | 4 | Submit email flags, skip, failure, idempotent |
| [`tests/utils/vendor-onboarding-email-delivery.test.js`](../tests/utils/vendor-onboarding-email-delivery.test.js) | 6 | Delivery helper unit tests |
| [`tests/email/email-notification-safety.test.js`](../tests/email/email-notification-safety.test.js) | 4 | Review gap audit, OTP/logging source checks |
| [`tests/stripe/order-email-safety.test.js`](../tests/stripe/order-email-safety.test.js) | 5 | Post-payment email call, duplicate guard, failed payment no-email, safe failure |
| [`tests/orders/order-lifecycle-emails.test.js`](../tests/orders/order-lifecycle-emails.test.js) | 4 | Shipping/tracking email, SMTP failure logging, return initiation, refund email |

**Current verification:** run `npm test` before merge; targeted #182 tests cover webhook timing, tracking, cancellation, refund, and lifecycle failure logging.

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
| B2 | Vendor ships order with tracking | Same | Inbox: shipping/tracking email; `lifecycleEmailLog` has one sent attempt |
| B3 | Customer cancel / return accepted | Same | Inbox: cancel/refund lifecycle email; `lifecycleEmailLog` has one sent attempt |

**Blockers:** `SMOKE_TEST_*` accounts not provisioned in repo — all live inbox proof **PENDING**.

---

## Remaining risks

| Risk | Detail |
| --- | --- |
| Pre-payment order helper drift | Legacy placed-email helpers remain exported but active `initiateOrder` does not call them |
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
