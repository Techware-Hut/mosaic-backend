# Final Domain Smoke Matrix

Date: 2026-06-24

Status values: `PASS`, `FAIL`, `BLOCKED`, `NOT TESTED`, `PRODUCT DECISION`.

## Customer

| Step | Status | Evidence/notes |
| --- | --- | --- |
| Homepage loads on apex | NOT TESTED | Run after DNS/Vercel cutover |
| Browse product | NOT TESTED |  |
| Browse service | NOT TESTED |  |
| Browse food | NOT TESTED |  |
| Search and filters | NOT TESTED |  |
| Fresh registration | NOT TESTED | Requires real email |
| Email OTP | NOT TESTED | Requires SMTP delivery |
| Session establishment | NOT TESTED | Must verify cookie from apex to API |
| Logout/login | NOT TESTED |  |
| Password reset | NOT TESTED | Requires email link |
| Cart | NOT TESTED |  |
| Checkout entry | NOT TESTED |  |
| Approved test-mode payment | BLOCKED | Requires written payment-test approval |
| Order confirmation | NOT TESTED | Depends on payment boundary |
| Order history | NOT TESTED |  |

## Business Owner

| Step | Status | Evidence/notes |
| --- | --- | --- |
| Fresh registration | NOT TESTED | Requires real email |
| OTP | NOT TESTED |  |
| Onboarding draft | NOT TESTED |  |
| Verification fee test boundary | BLOCKED | Requires written payment-test approval |
| Submission | NOT TESTED |  |
| Rejection/edit/resubmit | NOT TESTED | Requires admin QA workflow |
| Admin approval | NOT TESTED |  |
| Profile completion | NOT TESTED |  |
| Subscription | BLOCKED | Requires payment-test approval |
| Connect | NOT TESTED | Requires Stripe test account |
| Create listing | NOT TESTED |  |
| Edit listing | NOT TESTED |  |
| Publish listing | NOT TESTED |  |
| Delete listing | NOT TESTED |  |
| Order or booking receipt | NOT TESTED |  |

## Admin

| Step | Status | Evidence/notes |
| --- | --- | --- |
| Sign in | NOT TESTED |  |
| Role guard | NOT TESTED |  |
| Pending applications | NOT TESTED |  |
| Detail | NOT TESTED |  |
| Verify checklist | NOT TESTED |  |
| Approve/reject | NOT TESTED |  |
| Users | NOT TESTED |  |
| Vendors | NOT TESTED |  |
| Products/listings | NOT TESTED |  |
| Orders | NOT TESTED |  |
| Categories | NOT TESTED |  |
| Subscriptions | NOT TESTED |  |
| Content moderation | NOT TESTED |  |
| Audit events | NOT TESTED |  |

## System

| Step | Status | Evidence/notes |
| --- | --- | --- |
| Cookies from apex to API | NOT TESTED |  |
| CORS | NOT TESTED | Run preflight and browser auth |
| OAuth callback | NOT TESTED |  |
| Email links | NOT TESTED |  |
| Stripe returns | NOT TESTED |  |
| Webhooks | NOT TESTED |  |
| S3 uploads | NOT TESTED |  |
| Sentry events | NOT TESTED |  |
| Mobile | NOT TESTED |  |
| Accessibility | NOT TESTED |  |
| No console-critical errors | NOT TESTED |  |
