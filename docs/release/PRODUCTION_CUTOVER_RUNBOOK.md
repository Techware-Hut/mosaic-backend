# Production Cutover Runbook

Date: 2026-06-24

This runbook is executable only by the release owner and access holders. It intentionally does not include secrets or environment values.

## Preflight

1. Record current production frontend rollback identity: current Vercel production deployment URL/id and current `main` SHA.
2. Record current production backend rollback identity: current AWS deployment/application version, health release metadata, and current `main` SHA.
3. Confirm access holders for GitHub, Vercel, AWS, DNS, Stripe, MongoDB, Sentry, and email provider.
4. Confirm no active incident and no unreviewed production PR checks.
5. Confirm payment-test approval before any checkout or verification-fee test.

## Required Release Order

1. Confirm backend PR #129 still points to frozen staging SHA `799cff4eaaf2079bf2ce3b95078f0a8c45f32799`.
2. Confirm #129 checks are passing.
3. Get written human approval to merge backend #129.
4. Merge backend #129 into `main`.
5. Wait for AWS backend deployment to complete.
6. Confirm `GET https://api.mosaicbizhub.com/api/health`.
7. Confirm `GET https://api.mosaicbizhub.com/api/ready`.
8. Confirm deployed backend release identity matches the merged backend `main` SHA.
9. Run CORS preflight with `Origin: https://mosaicbizhub.com` against a credentialed auth route.
10. Verify transition origins still work: `https://app.mosaicbizhub.com` and `https://mosaic-biz-frontend-launch.vercel.app`.
11. Confirm frontend PR #215 still points to frozen develop SHA `d1e320356ef0cca6ff7456502cffeac4333fab70`.
12. Confirm #215 checks are passing.
13. Get written human approval to merge frontend #215.
14. Merge frontend #215 into `main`.
15. Wait for Vercel production deployment to complete.
16. Point or attach `https://mosaicbizhub.com` to the frontend production deployment.
17. Configure `www.mosaicbizhub.com` to redirect to apex while preserving path and query.
18. Keep `https://app.mosaicbizhub.com` as a temporary transition origin.
19. Verify SSL for apex, www redirect, app transition host, and API host.
20. Run the final-domain smoke matrix.
21. Roll back immediately if authentication, checkout, or onboarding fails.

## Command Templates

```bash
# Backend health
curl -i https://api.mosaicbizhub.com/api/health
curl -i https://api.mosaicbizhub.com/api/ready

# CORS preflight
curl -i -X OPTIONS "https://api.mosaicbizhub.com/api/users/login" \
  -H "Origin: https://mosaicbizhub.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"

# Featured route
curl -i "https://api.mosaicbizhub.com/api/featured-products?page=1&limit=1"
```

## Stop Conditions

- PR head SHA does not match the frozen candidate SHA.
- Required checks are failing or pending without approval.
- Backend health or ready fails after deployment.
- Backend release identity does not match merged `main`.
- Credentialed CORS from apex fails.
- Login/session cookies fail.
- Checkout/payment or vendor onboarding fails.
- DNS/SSL misconfiguration affects apex, www redirect, app transition host, or API host.
