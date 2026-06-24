# Backend MVP Launch Activation — Checkout / Email / Admin Smoke Proof

**Repo:** [Techware-Hut/mosaic-backend](https://github.com/Techware-Hut/mosaic-backend)  
**Branch:** `audit/backend-mvp-launch-activation-checkout-email-admin`  
**Evidence date:** 2026-06-19 (UTC)  
**Production API:** `https://api.mosaicbizhub.com`  
**Frontend origins tested:**

| Origin | Role |
| --- | --- |
| `https://mosaicbizhub.com` | **Canonical** - production frontend after the root-domain correction |
| `https://mosaic-biz-frontend-launch.vercel.app` | **Active** — current frontend testing origin |
| `https://app.mosaicbizhub.com` | **Transition** - legacy app origin until cutover smoke passes |

No secrets, cookie values, JWTs, passwords, OTPs, tester email, or PII in this document.

---

## 1. Executive verdict

**BACKEND MVP ACTIVATION: PARTIAL**

Public health, CORS, unauth guards, vendor session chain, role-based admin guards, and automated Stripe/checkout contract tests **PASS**. Checkout live payment, admin credentialed approval flows, Connect status on a linked business, and inbox email delivery remain **BLOCKED** or **NOT RUN** by policy (no live charges; no admin smoke account; test vendor has zero business records).

---

## 2. P0 blockers

| ID | Finding | Status |
| --- | --- | --- |
| — | None identified in this audit | **No P0** |

Public routes, payment route auth, webhook signature rejection, Connect checkout guards (unit tests), and non-admin → admin route denial all behave as expected on deployed production @ `ef83e24`.

---

## 3. P1 / P2 risks

| Sev | Risk | Evidence |
| --- | --- | --- |
| **P1** | `GET /api/admin/categories` is **public** (no `authenticate` / `isAdmin`) | Live **200** unauthenticated; returns aggregated category metadata |
| **P1** | Email sender uses **Gmail SMTP** (`MAIL_USER` / `MAIL_PASSWORD`); From header is `"Mosaic Biz Hub" <MAIL_USER>` | Code: [`utils/mailer.js`](../../utils/mailer.js). Production may send from personal/dev Gmail if `MAIL_USER` is not a transactional domain |
| **P1** | Admin credentialed smoke **BLOCKED** — no dedicated `SMOKE_TEST_ADMIN_*` account | Cannot live-verify approval queue, finalize, or admin order list with admin role |
| **P1** | Customer checkout initiate dry-run **BLOCKED** — only vendor test account available | `POST /api/orders/initiate` requires `customer` role; vendor session correctly returns **403** |
| **P2** | Legacy `POST /api/payments/create-payment-intent` exists without Connect destination split | Canonical marketplace flow is `POST /api/orders/initiate`; legacy route guarded but documented |
| **P2** | Deployed EB runtime **3 commits behind** local `main` | Deploy `ef83e24`; `main` HEAD `5180b2b` |
| **P2** | `npm run test:contract` **not wired on `main`** | Open [PR #98](https://github.com/Techware-Hut/mosaic-backend/pull/98); contract tests run locally from branch file (16 pass) |
| **P2** | [`scripts/smoke-backend.ps1`](../../scripts/smoke-backend.ps1) fails to parse on Windows (encoding/em-dash) | Used [`scripts/vendor-login-session-proof.ps1`](../../scripts/vendor-login-session-proof.ps1) + manual probes instead |

---

## 4. Checkout / payment / order status

**Verdict: PARTIAL** — code + unit tests + unauth/role guards PASS; live end-to-end payment NOT RUN.

### Canonical route inventory

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/cart/` | customer | Read cart |
| POST | `/api/cart/add` | customer | Add to cart |
| **POST** | **`/api/orders/initiate`** | **customer** | Create order + Connect destination PaymentIntent |
| GET | `/api/orders/retrieve-intent/:id` | customer | Poll PI + order after payment |
| GET | `/api/orders/user` | customer | Customer order history |
| GET | `/api/orders/vendor` | business_owner | Vendor paid/refunded orders |
| GET | `/api/orders/admin` | admin | Admin order list |
| POST | `/api/webhooks/stripe` | Stripe sig | Order status: paid / failed / refunded |
| POST | `/api/stripe/payment/webhook` | Stripe sig | Post-payment enrichment, fee/transfer IDs, emails |
| POST | `/api/payments/create-payment-intent` | customer | **Legacy** — no Connect split |

### Code inspection (audit-only)

| Check | Result |
| --- | --- |
| Webhook routes mounted **before** `express.json()` in [`app.js`](../../app.js) | **PASS** |
| `application_fee_amount` + `transfer_data.destination` in `initiateOrder` | **PASS** — [`controllers/orderController.js`](../../controllers/orderController.js) |
| Checkout guards block unapproved / inactive / unconnected vendor | **PASS** — [`utils/checkoutGuards.js`](../../utils/checkoutGuards.js) |
| Refunds use `reverse_transfer` + `refund_application_fee` | **PASS** — orderController |
| Payment does not bypass platform (Connect destination charge) | **PASS** — canonical path only |

### Automated tests

| Suite | Result |
| --- | --- |
| `npm test` | **228 pass**, 0 fail |
| Launch contract (PR #98 file, run via `node --test tests/launch/backend-launch-contract.test.js`) | **16 pass**, 0 fail |
| Stripe Connect checkout / webhook / email safety tests | Included in full suite — **PASS** |

### Live production probes

| Method | Path | Expected | HTTP | Result |
| --- | --- | --- | --- | --- |
| POST | `/api/orders/initiate` | 401 unauth | **401** | **PASS** |
| POST | `/api/payments/create-payment-intent` | 401 unauth | **401** | **PASS** |
| POST | `/api/webhooks/stripe` | 400 without signature | **400** | **PASS** |
| POST | `/api/orders/initiate` | 403 vendor role | **403** | **PASS** |
| GET | `/api/orders/vendor` | 200 vendor session | **200** | **PASS** |
| GET | `/api/orders/user` | 200 or 403 by role | **200** | **PASS** (vendor account allowed read) |
| POST | `/api/orders/initiate` | 201 with cart + connected vendor | — | **NOT RUN** — no customer account + no live charge policy |

---

## 5. Stripe Connect status

**Verdict: PARTIAL** — routes and guards verified; Connect status on test vendor **BLOCKED** (zero businesses).

### Route inventory

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/connect/:businessId/account-link` | business_owner | Stripe Account Link onboarding |
| GET | `/api/connect/:businessId/status` | business_owner | Poll + sync Connect state |
| GET | `/api/connect/return` | public | Redirect to frontend return |
| GET | `/api/connect/refresh` | public | Redirect to frontend refresh |
| POST | `/stripe/account-session` | business_owner | Embedded Connect dashboard session |
| POST | `/stripe/express-login-link` | business_owner | Express Dashboard login link |

### Live probes

| Method | Path | Expected | HTTP | Result |
| --- | --- | --- | --- | --- |
| POST | `/api/connect/:businessId/account-link` | 401 unauth | **401** | **PASS** |
| POST | `/stripe/account-session` | 401 unauth | **401** | **PASS** |
| GET | `/api/connect/:businessId/status` | 200 credentialed vendor | — | **BLOCKED** — `GET /api/business/my` returned `count: 0` (no businessId) |
| POST | `/api/connect/:businessId/account-link` | 200 credentialed | — | **BLOCKED** — same |

### Required env var names (values never recorded)

`STRIPE_SECRET_KEY`, `PLATFORM_FEE_CENTS`, `FRONTEND_URL`, `CONNECT_RETURN_PATH`, `CONNECT_REFRESH_PATH`, `CONNECT_RETURN_URL`, `CONNECT_REFRESH_URL`, `STRIPE_BUSINESS_DRAFT_WEBHOOK_SECRET`, `STRIPE_ORDER_WEBHOOK_SECRET`, `STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET`

### Unconnected vendor behavior (code + unit tests)

`getBusinessCheckoutBlock` returns **400** `"Vendor is not connected to Stripe."` when `stripeConnectAccountId` is missing; `initiateOrder` additionally live-retrieves Stripe account and blocks incomplete onboarding.

---

## 6. Email / OTP / rate-limit status

**Verdict: PARTIAL** — configuration audited; inbox delivery and OTP content **NOT RUN**.

| Item | Finding |
| --- | --- |
| Provider | Nodemailer + Gmail SMTP (`MAIL_USER`, `MAIL_PASSWORD`) |
| From display | `"Mosaic Biz Hub" <MAIL_USER>` |
| OTP | 6 digits, 10 min expiry, bcrypt hash; login may return **403** + `otpPending` for unverified users |
| Rate limits (15 min window) | register **5**, login **15**, verify-otp **10**, resend-otp **5**, forgot-password **5**, reset-password **10** |
| Live login during smoke | **200** — no **429** rate-limit observed |
| Production sender risk | **P1** if `MAIL_USER` is personal Gmail — recommend transactional provider + verified domain |
| Inbox / OTP receipt | **NOT RUN** — no OTP values or email bodies logged |

**Env var names:** `MAIL_USER`, `MAIL_PASSWORD`, `ADMIN_EMAIL`, `SUPPORT_EMAIL`, `APP_NAME`, `APP_URL`

---

## 7. Admin / vendor approval status

**Verdict: PARTIAL** — unauth and non-admin guards PASS; admin credentialed tier **BLOCKED**.

| Method | Path | Session | Expected | HTTP | Result |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/users/login` | — | 200 vendor | **200** | **PASS** |
| GET | `/api/users/auth/check` | vendor cookies | 200 | **200** | **PASS** |
| GET | `/api/vendor-onboarding/pending` | none | 401 | **401** | **PASS** |
| GET | `/api/vendor-onboarding/pending` | vendor | 403 | **403** | **PASS** |
| GET | `/api/orders/admin` | none | 401 | **401** | **PASS** |
| GET | `/api/orders/admin` | vendor | 403 | **403** | **PASS** |
| POST | `/api/vendor-onboarding/:id/finalize` | vendor | 403 | **403** | **PASS** |
| GET | `/admin/users` | none | 401 | **401** | **PASS** |
| POST | `/api/admin/category/product` | none | 401 | **401** | **PASS** |
| GET | `/api/admin/categories` | none | 200 public | **200** | **PASS** (P1 public exposure note) |
| GET | `/api/vendor-onboarding/pending` | admin | 200 | — | **BLOCKED** — no admin credentials |
| POST | `/api/vendor-onboarding/:id/finalize` | admin | 200 | — | **NOT RUN** |

Admin login uses same `POST /api/users/login` as other roles; admin routes use `authenticate` + `isAdmin`.

---

## 8. Route inventory — tested areas (A–F)

### A. Health / public

| Method | Path | HTTP | Result |
| --- | --- | --- | --- |
| GET | `/` | **200** | **PASS** |
| GET | `/api/health` | **200** | **PASS** |
| GET | `/api/ready` | **200** | **PASS** |
| GET | `/api/featured-products` | **200** | **PASS** |
| GET | `/api/admin/categories` | **200** | **PASS** (public) |

### F. CORS / cookies

| Origin | Path | Method | ACAO | Credentials | Result |
| --- | --- | --- | --- | --- | --- |
| apex | `/api/featured-products` | OPTIONS | pending | pending | **REQUIRED after cutover** |
| apex | `/api/users/login` | OPTIONS | pending | pending | **REQUIRED after cutover** |
| launch Vercel | `/api/featured-products` | OPTIONS | exact match | **true** | **PASS** |
| launch Vercel | `/api/users/login` | OPTIONS | exact match | **true** | **PASS** |
| app.mosaicbizhub.com | `/api/featured-products` | OPTIONS | exact match | **true** | **PASS** |
| app.mosaicbizhub.com | `/api/users/login` | OPTIONS | exact match | **true** | **PASS** |

**Cookie attributes (vendor login, names/flags only):** `token` HttpOnly, Secure, SameSite=None, Domain=.mosaicbizhub.com, Path=/; `user_session` Secure, SameSite=None; `user_gender` present.

**CORS env var names:** `CORS_ORIGINS`, `FRONTEND_URL`, `NODE_ENV`  
**Cookie env var names:** `COOKIE_DOMAIN`, `COOKIE_SECURE`, `COOKIE_SAMESITE`

---

## 9. Commands run and results

| Command | Exit | Result |
| --- | --- | --- |
| `git fetch origin main && git checkout main && git pull` | 0 | Up to date @ `5180b2b` |
| `git checkout -b audit/backend-mvp-launch-activation-checkout-email-admin` | 0 | Branch created |
| `npm test` | 0 | **228 pass**, 0 fail |
| `node --test tests/launch/backend-launch-contract.test.js` | 0 | **16 pass** (PR #98 file; not on `main` script yet) |
| `gh run list --workflow "Deploy to Elastic Beanstalk" --limit 1` | 0 | Deploy SHA **`ef83e24`** |
| Manual public + unauth probes | 0 | Health/CORS/unauth **PASS** |
| `./scripts/vendor-login-session-proof.ps1` (launch origin) | 0 | Vendor cookie chain **PASS** |
| Credentialed role-guard + Connect probes | 0 | Guards **PASS**; Connect **BLOCKED** (no business) |
| `./scripts/smoke-backend.ps1` | 1 | **SKIP** — PowerShell parse error (encoding) |

---

## Deployed commit SHA

| Field | Value |
| --- | --- |
| **`main` HEAD (local)** | `5180b2b` — Merge PR #94 (docs as-built pack) |
| **Latest EB production deploy (GHA)** | `ef83e24` — Merge PR #93 (vendor login session cookie smoke fix) |
| **GHA deploy run** | [27798326208](https://github.com/Techware-Hut/mosaic-backend/actions/runs/27798326208) (2026-06-19T00:43:44Z, success) |
| **Commits on `main` not yet deployed** | **3** (`ef83e24..5180b2b`) |
| **Open PR #98** | Not merged — launch contract script + additional smoke guards |

Live probes reflect **deployed** runtime @ `ef83e24`.

---

## 10. What was not tested

- Live Stripe payment / charge confirmation (policy: no real charges on production)
- Webhook happy-path with valid Stripe signature
- Customer `POST /api/orders/initiate` with populated cart and connected vendor
- Email inbox delivery (OTP, order confirmation, vendor approval emails)
- Admin credentialed: pending queue, finalize approve/deny, admin order list
- Connect account-link / status with vendor that has a business + Stripe account
- `POST /api/stripe/create-checkout-session` (business-draft subscription flow)
- Vendor verification fee payment (`/api/vendor-onboarding/stage1/create-payment`)

---

## 11. Recommended next steps

1. **Merge PR #98** — wire `npm run test:contract` on `main` and deploy.
2. **Provision smoke accounts** — dedicated customer + admin (`SMOKE_TEST_*`); vendor with at least one business + Connect onboarding for Connect status probes.
3. **Email sender hardening** — move from Gmail SMTP to transactional provider; set production `MAIL_USER` to verified domain address.
4. **Decide on `GET /api/admin/categories`** — add `authenticate` + `isAdmin` if aggregate admin shape should not be public (P1).
5. **Fix `smoke-backend.ps1` encoding** on Windows (replace smart quotes/em-dashes) for repeatable CI/local smoke.
6. **Deploy `main`** to EB when ready so production matches latest docs/tests.
7. **Rotate** any credentials used for this smoke session.

---

## 12. PR needed?

**Yes — docs-only PR** on branch `audit/backend-mvp-launch-activation-checkout-email-admin` containing this evidence file only. No `.env`, no payment/webhook logic changes, no middleware reorder.

---

## Gate reference

Prior vendor auth/session proof: [`BACKEND_VENDOR_AUTH_SESSION_SMOKE_GATE_3.md`](BACKEND_VENDOR_AUTH_SESSION_SMOKE_GATE_3.md) — **PASS** (2026-06-19).
