# Vendor Email Lifecycle Matrix

Audit date: 2026-07-02

## Resend Integration Status

The backend does not use the Resend SDK or `RESEND_*` environment variables. Active transactional email uses Nodemailer through the shared SMTP configuration in `utils/smtpTransport.js`. In production, Resend is supported through provider-neutral SMTP configuration:

- `MAIL_HOST`
- `MAIL_PORT`
- `MAIL_SECURE`
- `MAIL_USER`
- `MAIL_PASSWORD`
- `MAIL_FROM`

For Resend SMTP, `MAIL_FROM` is required because `MAIL_USER` is commonly the SMTP login identity, not a verified sender address. Vendor onboarding email delivery now treats Resend SMTP as not configured when `MAIL_FROM` is missing, and logs missing environment variable names only.

## Lifecycle Matrix

| Email Type | Trigger Event | Recipient | Source File/Function | Resend Template/Subject | Status | Test Coverage |
| --- | --- | --- | --- | --- | --- | --- |
| business_owner welcome email | OTP verification succeeds after business owner registration | `User.email` | `controllers/userController.js` -> `utils/mailer.sendWelcomeEmail` | `Welcome to Mosaic Biz Hub - Grow your business and build generational wealth` | Working through shared SMTP/Resend-SMTP config; sent after verification, not before OTP verification | `tests/email/auth-mailer-smtp.test.js` |
| vendor application received email | `POST /api/vendor-onboarding/submit` transitions draft/rejected/payment_pending to submitted | authenticated vendor `User.email` | `controllers/vendorOnboarding.controller.js` -> `sendVendorSubmissionConfirmationEmail` | `Your Mosaic Biz Hub Application Is Under Review` | Working; non-blocking; idempotent resubmit does not resend | `tests/vendor/vendor-onboarding-submit-email.test.js`, `tests/email/vendor-verification-guidance-mail.test.js` |
| admin new vendor application notification | `POST /api/vendor-onboarding/submit` succeeds | `ADMIN_EMAIL` | `controllers/vendorOnboarding.controller.js` -> `sendAdminOnboardingSubmissionEmail` | `New Vendor Application Submitted - Review Required` | Working when `ADMIN_EMAIL` is configured; admin failure does not block vendor confirmation job | `tests/vendor/vendor-onboarding-submit-email.test.js` |
| vendor application approved email | Admin finalizes a submitted application and required docs are verified | populated `application.userId.email` | `controllers/admin/vendorOnboardVerifyStage1.js` -> `sendVendorApprovedEmail` | `Your Business Has Been Successfully Verified` | Working; non-blocking; finalize route only runs from submitted status | `tests/admin/vendor-onboarding-finalize.test.js` |
| vendor trust badge assigned email | Admin approval assigns a badge | populated `application.userId.email` | `controllers/admin/vendorOnboardVerifyStage1.js` -> `sendVendorTrustBadgeAssignedEmail` | `Your Trust Badge Has Been Verified and Activated` | Working when a badge is assigned; non-blocking | `tests/admin/vendor-onboarding-finalize.test.js` |
| vendor application rejected / missing documents email | Admin finalizes submitted application with missing required docs | populated `application.userId.email` | `controllers/admin/vendorOnboardVerifyStage1.js` -> `sendVendorRejectionEmail` -> `sendVendorVerificationGuidanceEmail` | `Action Required: Vendor Application Documents Needed` | Working; writes `verificationNotificationLog` including delivery status and provider message ids when available | `tests/admin/vendor-onboarding-finalize.test.js`, `tests/email/vendor-verification-guidance-mail.test.js` |
| vendor missing documents / failing verification guidance | Admin calls `POST /api/vendor-onboarding/:applicationId/verification-guidance` | populated `application.userId.email` | `controllers/admin/vendorOnboardVerifyStage1.js` -> `sendVendorVerificationGuidanceEmail` | Outcome-specific guidance subject | Working; duplicate outcome/reason/doc/field payloads are deduped by fingerprint | `tests/admin/vendor-onboarding-finalize.test.js`, `tests/email/vendor-verification-guidance-mail.test.js` |
| admin vendor profile completed notification | Vendor completes business profile plus required docs | `ADMIN_EMAIL` | `controllers/vendorOnboarding.controller.js` -> `sendAdminVendorProfileCompletedEmail` | `Vendor Profile Completed - Documentation Ready for Trust Badge Verification` | Working; deduped with `profileCompletionNotifiedAt`; no dedicated unit test yet | Needs follow-up test |
| vendor verification fee/payment receipt | Stripe vendor verification payment succeeds | Vendor/business owner | `controllers/vendorOnboarding.controller.js` webhook only updates `verificationPayment` | Not implemented | Future/needs decision; Stripe webhook logic intentionally not changed in this audit | Not covered |
| vendor tier/subscription confirmation | Subscription invoice/payment succeeds | Vendor/business owner | `controllers/webhookController.handleSubscriptionWebhook` updates subscription status | Not implemented | Future/needs decision; subscription webhook logic intentionally not changed in this audit | Not covered |
| Stripe Connect onboarding started/reminder/status | Connect account link created or status polled | Vendor/business owner | `controllers/connectController.js` | Not implemented | Future/needs decision; Connect routes return UI state only | Not covered |
| vendor listing published/approved | Listing created/published | Vendor/business owner | Product/service/food controllers | Not implemented as email | Future/needs decision | Not covered |

## Required Environment Variable Names

Vendor lifecycle email delivery requires:

- `MAIL_USER`
- `MAIL_PASSWORD`
- `MAIL_FROM` when using Resend SMTP

Recommended for Resend SMTP:

- `MAIL_HOST`
- `MAIL_PORT`
- `MAIL_SECURE`

Additional notification/link names:

- `ADMIN_EMAIL`
- `SUPPORT_EMAIL`
- `FRONTEND_URL`
- `APP_URL`
- `CANONICAL_FRONTEND_URL`
- `PUBLIC_FRONTEND_URL`

Legacy or unused in active code:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `RESEND_FROM_NAME`

## Production-Safe Smoke Plan

1. Configure only names above in the production environment; do not record values.
2. Create a new business owner test account and verify OTP.
3. Confirm the business-owner welcome email is accepted by the SMTP/Resend provider.
4. Save a complete vendor onboarding draft and complete the verification payment in Stripe test mode where available.
5. Submit the vendor application with `POST /api/vendor-onboarding/submit`.
6. Confirm vendor application received email and admin new application email.
7. Approve one submitted application as admin and confirm vendor approval/trust badge email.
8. Use a separate submitted test application with missing docs, finalize/reject, and confirm missing-documents email.
9. Use `POST /api/vendor-onboarding/:applicationId/verification-guidance` with a unique reason and confirm guidance email plus dedupe on retry.
10. Capture user id, application id, delivery status, and provider message id/log status only. Do not capture secrets, OTPs, cookies, document URLs, or full message bodies.
