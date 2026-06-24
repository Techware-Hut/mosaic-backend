# Final Runtime Test Gaps

Date: 2026-06-24
Repository: `Techware-Hut/mosaic-backend`
Branch audited: `codex/backend-final-preprod-audit`
Starting staging SHA: `28f9be37c6ae168605ad1d978d32fb013ddfe3af`

The final backend pass reran automated unit and contract coverage and added one focused test gap close. The items below still require live runtime proof and should not be treated as automated failures.

## Required Live QA

| Area | Runtime proof needed | Why automated tests are insufficient |
| --- | --- | --- |
| Fresh customer registration | Register a new customer at `https://mosaicbizhub.com`, receive email OTP, verify, confirm session | Requires real SMTP, browser cookies, deployed frontend/API |
| Fresh vendor registration | Register a new vendor, receive email OTP, verify, confirm vendor role/session | Requires real SMTP and final-domain cookie/CORS proof |
| OTP resend | Trigger resend for a fresh unverified account and confirm deliverability | Local tests mock mail behavior |
| Login/session/logout | Customer, vendor, and admin login followed by `GET /api/users/auth/check`, then logout | Requires browser cookie behavior across apex frontend and API subdomain |
| Forgot/reset password | Request reset email, submit OTP/new password, confirm old sessions invalidated | Requires real mail delivery and final-domain link correctness |
| Vendor draft/edit/resubmit | Save draft, edit rejected draft, explicit submit to `submitted` | Automated tests cover logic, but live data/account state still needs proof |
| Vendor verification payment | Create Stage 1 verification payment and reconcile payment status | Payment execution requires written payment-test approval |
| Admin review/finalize | Admin pending/detail/verify/finalize on a fresh vendor application | Destructive workflow against live data needs a dedicated QA account |
| Business approval/visibility | Confirm approved active business appears in public marketplace and rejected/inactive does not | Requires live catalog/business fixtures |
| Public marketplace filters | Products, services, food, search, location, badge, category, price, pagination | Automated tests prove rules; live data distribution may expose fixture gaps |
| Featured products | `GET /api/featured-products` from final deployed frontend/API | Requires deployed frontend path and live featured catalog |
| Product delete | Vendor deletes owned product and variants disappear from public/private lists | Automated test covers controller behavior; live data should prove UI/API consistency |
| Service booking | Customer books service through final frontend and receives expected booking state | Requires real account, live service, and optional email/payment path decisions |
| Cart | Add/update/remove/merge/count with authenticated account and guest cart | Requires browser local/session state and live catalog |
| Order initiation | `POST /api/orders/initiate` with approved active connected vendor | Real Stripe test-mode Connect account required |
| Legacy payment intent | If still used, prove `POST /api/payments/create-payment-intent` with owned order | Route is guarded but legacy; run only if frontend path remains used |
| Stripe Connect onboarding | Account link, return, refresh, status polling, dashboard helper routes | Requires final env URLs and Stripe test account |
| Health/ready | Production `GET /api/health` and `GET /api/ready` after promotion | Must prove production runs intended promoted commit |
| Webhooks | Test-mode Stripe events to each registered webhook endpoint | Requires Stripe CLI/dashboard and deployed URL |

## Product Decisions

| Decision | Current behavior | Needed owner decision |
| --- | --- | --- |
| Food default price ceiling | `GET /api/food/list` defaults to `0-200` unless `price=all` is supplied | Decide whether this MVP default should remain |
| Category totals | Category product/service counts are published-count aggregates and are not proven to match approved/active marketplace visibility | Decide whether category totals should be public-visible counts only |
| Business usage fields | New Business records initialize `usage.totalProducts` and `usage.totalServices`, but current listing totals come from product/service/variant queries | Decide whether usage fields should become authoritative or remain informational |
| Available locations | Filters support city/state/country, but no current backend endpoint exposes only locations with visible listings | Decide whether to build a listing-location metadata endpoint |
| Stripe Connect scope | Connect ownership is business-scoped, not vertical-specific | Decide whether all vendor verticals require Connect or only product checkout vendors |

## Safe Runtime Order

1. `GET /api/health` and `GET /api/ready` after promotion.
2. Browser CORS/cookie login smoke for customer, vendor, and admin.
3. Fresh registration/OTP for customer and vendor.
4. Vendor onboarding draft/save/submit without payment first where possible.
5. Admin review/finalize using a dedicated QA application.
6. Public marketplace visibility checks for approved/rejected/inactive fixtures.
7. Cart and service booking with dedicated QA customer.
8. Stripe Connect and checkout/payment only after written payment-test approval.
9. Webhook delivery tests with Stripe test-mode tooling.

## Not Tested In This Pass

- Live production SMTP delivery.
- Live AWS S3 presigned upload and object accessibility.
- Live Stripe payment execution.
- Live Stripe webhook delivery.
- Live OAuth callback with real Google account.
- Performance/load under production traffic.
- Data migration or cleanup scripts.
- DNS, AWS environment values, and deployment behavior.
