# Production Auth Email Delivery Investigation — 2026-06-29

## Scope

OTP registration, forgot-password, and resend-otp mail delivery on production API. No deploy performed. No secrets, OTPs, or credentials printed or committed.

## 2026-06-30 Resolved Status

Auth email delivery is now **passing** in production after deploying provider-neutral SMTP support for the Resend-backed `MAIL_*` configuration.

| Item | Value |
| --- | --- |
| Backend feature branch | `fix/auth-email-resend-smtp` |
| Implementation commit | `75209f7` |
| Production merge commit | `a5a4e54` |
| Production deploy workflow | `deploy-eb-production.yml` run `28459250020` - success |
| Production API | `https://api.mosaicbizhub.com` |
| Production frontend smoke target | `https://mosaicbizhub.com` |

Current auth SMTP env contract:

| Variable | Purpose |
| --- | --- |
| `MAIL_HOST` | Provider-neutral SMTP host for auth OTP/password-reset mail. When unset, the Gmail fallback remains available. |
| `MAIL_PORT` | SMTP port, parsed as a number. |
| `MAIL_SECURE` | SMTP secure flag, parsed as a boolean. |
| `MAIL_USER` | SMTP login identity. |
| `MAIL_PASSWORD` | SMTP password/API key. |
| `MAIL_FROM` | From header for auth mail. Falls back to `"Mosaic Biz Hub" <MAIL_USER>`. |

Production checks on 2026-06-30:

| Probe | Result |
| --- | --- |
| `GET /api/health` | 200, `status: ok`, release commit `a5a4e54` |
| `GET /api/ready` | 200, `status: ready`, `database: connected`, `authEmail.configured: true`, release commit `a5a4e54` |
| `GET /api/build-info` | 200, release commit `a5a4e54` |
| `./scripts/auth-email-smoke.ps1 -ApiBaseUrl https://api.mosaicbizhub.com -ProbeDelaySeconds 30` | PASS 6, FAIL 0, SKIP 2 |
| Customer registration OTP delivery | Passed with disposable inbox; email arrived |
| Vendor registration OTP delivery | Passed with disposable inbox; email arrived |
| Customer resend OTP delivery | Passed with disposable inbox; email arrived |
| Vendor resend OTP delivery | Passed through production frontend browser smoke; email arrived |
| Customer forgot-password OTP delivery | Passed with disposable inbox; email arrived |
| Vendor forgot-password OTP delivery | Passed with disposable inbox; email arrived |
| Unknown forgot-password anti-enumeration | 200 generic response; no mailbox delivery observed |

Frontend production browser smoke on 2026-06-30 also confirmed customer and vendor signup pages reached `/verify-otp`, resend calls returned 200, forgot-password pages advanced to the reset step, and all related mailbox delivery checks passed. The smoke output recorded only statuses and booleans; no email addresses, OTPs, tokens, cookies, credentials, env values, or email bodies were printed.

The sections below are retained as historical failure analysis from 2026-06-29.

## Branch and commit

| Item | Value |
| --- | --- |
| Feature branch | `fix/production-auth-email-delivery` |
| Base (staging) | `370bb42df6f856ab39b327678d54e3dca6544bf9` |
| Production live commit (probed) | `90d7292` (`GET /api/build-info`) |
| Production API | `https://api.mosaicbizhub.com` |

## Files inspected

| File | Purpose |
| --- | --- |
| `utils/mailer.js` | Gmail Nodemailer transporter, OTP + reset mail |
| `utils/authEmailDelivery.js` | `MAIL_USER`/`MAIL_PASSWORD` gate, safe error logging |
| `controllers/userController.js` | Register/resend 502; forgot-password 500 on mail failure |
| `routes/userRoutes.js` | Rate limiters (5 req / 15 min / IP) |
| `routes/healthRoutes.js` | Added `authEmail.configured` on `/api/ready` (post-merge, pre-deploy on prod) |
| `scripts/auth-email-smoke.ps1` | Spaced production probes (status codes only) |
| `docs/production-env-checklist.md` | EB mail setup, probe matrix, restart requirement |
| `tests/health/health-readiness.test.js` | `authEmail.configured` tests |
| `tests/auth/otp-email-delivery.test.js` | 502 OTP delivery contract |
| `tests/utils/auth-email-delivery.test.js` | Env gate tests |

## Required env var names (auth OTP)

| Variable | Required for auth OTP |
| --- | --- |
| `MAIL_USER` | Yes |
| `MAIL_PASSWORD` | Yes (Google App Password) |

`ADMIN_EMAIL` is **not** required for auth OTP (admin notifications only).

## EB production env names to verify

**P0:** `MAIL_USER`, `MAIL_PASSWORD`

**P1 (other mail):** `ADMIN_EMAIL`, `SUPPORT_EMAIL`, `APP_NAME`, `APP_URL`

EB application: `mosaic-biz-hub-backend`  
EB environment: `mosaic-backend-env` (us-east-1)

AWS CLI was **not available** in the investigation session. Operator must run:

```powershell
aws elasticbeanstalk describe-configuration-settings `
  --application-name mosaic-biz-hub-backend `
  --environment-name mosaic-backend-env `
  --region us-east-1 `
  --query "ConfigurationSettings[0].OptionSettings[?Namespace=='aws:elasticbeanstalk:application:environment'].[OptionName,Value]" `
  --output table
```

Redact values before sharing. After setting mail vars: **restart EB environment**.

CloudWatch log grep (safe signatures only): `Auth OTP email skipped`, `MAIL_USER/MAIL_PASSWORD not configured`, `Auth OTP email delivery failed`, `Failed to send password reset OTP email`, `EAUTH`, `535`, `Invalid login`.

## Root-cause assessment

| Rank | Cause | Status |
| --- | --- | --- |
| 1 | Missing/invalid `MAIL_USER` or `MAIL_PASSWORD` on EB | **Confirmed likely** — production returns **502** on register/resend (SMTP delivery failure path, not missing-route) |
| 2 | Invalid Gmail App Password / revoked credentials | **Possible** — same symptom; confirm via EB logs (`EAUTH`, `535`) |
| 3 | Rate limiting from burst probes | **Not primary** in this run — no **429** observed (10s spacing used) |
| 4 | EB outbound SMTP network block | **Unverified** — requires operator network test to `smtp.gmail.com:587` |
| 5 | Application code regression | **Ruled out** — `npm test` 438 pass; failure contract matches design |

**Conclusion:** Infrastructure/configuration blocker. Application correctly surfaces SMTP failure. Production cannot deliver auth email until EB mail env is set with valid Gmail App Password and environment is restarted.

## Commands / probes run

```powershell
git checkout staging && git pull origin staging
git checkout -b fix/production-auth-email-delivery
npm test
node --test tests/auth/otp-email-delivery.test.js tests/utils/auth-email-delivery.test.js
node --test tests/health/health-readiness.test.js
Invoke-RestMethod https://api.mosaicbizhub.com/api/build-info
Invoke-RestMethod https://api.mosaicbizhub.com/api/ready
./scripts/auth-email-smoke.ps1 -ApiBaseUrl https://api.mosaicbizhub.com -DisposableDomain example.invalid -ProbeDelaySeconds 10
```

## Route / status table (production probes 2026-06-29)

| Probe | Route | Status | Expected (mail working) | Result |
| --- | --- | ---: | ---: | --- |
| Build identity | `GET /api/build-info` | 200 | 200 | Pass |
| Readiness | `GET /api/ready` | 200 | 200 | Pass |
| Customer forgot-password | `POST /api/users/forgot-password` | — | 200 | Skip (no `SMOKE_TEST_CUSTOMER_EMAIL`) |
| Vendor forgot-password | `POST /api/users/forgot-password` | — | 200 | Skip (no `SMOKE_TEST_VENDOR_EMAIL`) |
| Customer register (disposable) | `POST /api/users/register` | **502** | 201 | **Fail** — OTP delivery blocked |
| Vendor register (disposable) | `POST /api/users/register` | **502** | 201 | **Fail** — OTP delivery blocked |
| Resend OTP (disposable customer) | `POST /api/users/resend-otp` | **502** | 200 | **Fail** — OTP delivery blocked |
| Unknown forgot-password | `POST /api/users/forgot-password` | 200 | 200 | Pass (anti-enumeration) |

## Email delivery status

**Still blocked** on production after deploy `a461b15` (2026-06-29).

| Signal | Result |
| --- | --- |
| `GET /api/ready` `authEmail.configured` | **true** — `MAIL_USER` and `MAIL_PASSWORD` are present in EB process env |
| Register / resend OTP | **502** `OTP_DELIVERY_FAILED` |
| Known customer/vendor forgot-password | **500** `Failed to send reset OTP` |
| Unknown forgot-password | **200** (anti-enumeration OK) |

**Revised root cause:** Not missing env vars. SMTP credentials are set but **Gmail delivery is failing** at send time — likely invalid/expired App Password, revoked credentials (`EAUTH` / `535`), or outbound SMTP connectivity from EB. Operator: rotate Google App Password on the `MAIL_USER` account, update `MAIL_PASSWORD` on EB, restart environment, grep CloudWatch for `Auth OTP email delivery failed` and Nodemailer auth errors.

## Production deploy (2026-06-29)

| Item | Value |
| --- | --- |
| PR | [#164](https://github.com/Techware-Hut/mosaic-backend/pull/164) `staging` → `main` |
| Deployed commit | `a461b151127054ad1b31f14122f9291a8d40d4a3` |
| GHA deploy run | Success (Deploy to Elastic Beanstalk #119) |
| `authEmail.configured` on `/api/ready` | **true** |

Post-deploy auth-email smoke (MBH_TEST_* emails from session `.env.local`, status codes only): PASS 3 / FAIL 5 / SKIP 0.

## Code changes in this branch (operability, no auth behavior change)

1. `GET /api/ready` includes `authEmail: { configured: boolean }` (env presence only, no SMTP probe).
2. `scripts/auth-email-smoke.ps1` — spaced status-code probes.
3. `docs/production-env-checklist.md` — EB restart, probe matrix, `ADMIN_EMAIL` clarification.

## Secrets confirmation

No env values, OTPs, passwords, tokens, SMTP credentials, or email contents were printed in logs or committed to git.

## Recommended next actions

1. **Operator (P0):** Set `MAIL_USER` and `MAIL_PASSWORD` (Google App Password) on `mosaic-backend-env`; restart EB.
2. **Operator:** Grep CloudWatch for SMTP signatures listed above.
3. **Deploy:** Merge this branch to `staging`, promote/deploy so `/api/ready` exposes `authEmail.configured` for quick env checks.
4. **Re-probe:** After EB fix + optional deploy, run `./scripts/auth-email-smoke.ps1` with known `SMOKE_TEST_CUSTOMER_EMAIL` / `SMOKE_TEST_VENDOR_EMAIL` and a disposable domain you control; wait ≥15 min if prior burst caused **429**.
5. **Long-term:** Consider transactional provider (SES/SendGrid) with verified `mosaicbizhub.com` sender if Gmail limits persist.
