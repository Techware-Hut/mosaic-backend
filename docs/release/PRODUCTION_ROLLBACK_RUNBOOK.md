# Production Rollback Runbook

Date: 2026-06-24

Use this runbook if cutover introduces a P0 failure. Do not debug in production while authentication, checkout, or onboarding is broken.

## Rollback Triggers

| Trigger | Action |
| --- | --- |
| Backend `/api/health` or `/api/ready` fails after deploy | Roll back backend immediately |
| Backend release identity differs from merged `main` SHA | Pause frontend merge; investigate deploy |
| Apex credentialed CORS fails | Roll back or fix backend env before frontend cutover |
| Login/session cookie fails | Roll back frontend/backend depending on source |
| Checkout/order/payment intent fails | Stop payment tests; roll back if customer checkout is impacted |
| Stripe Connect onboarding return/refresh fails | Roll back or restore prior env/route config |
| Vendor onboarding submit/admin approval fails | Roll back if launch-critical |
| DNS/SSL breaks apex or www redirect | Revert DNS/Vercel domain change |

## Backend Rollback

1. Identify prior known-good backend `main` SHA and AWS deployment/application version.
2. Redeploy the prior AWS backend version or revert the #129 merge commit on `main`.
3. Confirm `GET /api/health`.
4. Confirm `GET /api/ready`.
5. Confirm release metadata matches rollback identity.
6. Re-run CORS preflight from `https://mosaicbizhub.com`.
7. Preserve logs and failing request IDs for postmortem.

## Frontend Rollback

1. Identify prior known-good frontend Vercel production deployment and `main` SHA.
2. Promote the prior Vercel deployment or revert the #215 merge commit on `main`.
3. Confirm apex loads the previous deployment.
4. Confirm login page, homepage, product/service/food browse routes load.
5. Preserve Vercel deployment logs and browser console/network evidence.

## DNS / Domain Rollback

1. Restore the prior domain attachment or DNS records.
2. Keep `app.mosaicbizhub.com` available as transition fallback.
3. Confirm SSL after revert.
4. Confirm path/query preserving redirect behavior if `www` was changed.

## Data Safety

- Do not manually edit live vendor/customer/order/payment records during rollback unless Bryan explicitly approves.
- If a payment test was attempted, record Stripe test-mode payment intent, order id, and account id.
- If onboarding was attempted, record application id and timestamps.
