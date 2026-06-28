# Seed Data And Local Bootstrap Audit - 2026-06-28

**Issue:** #70 - Seed data and local development bootstrap cleanup  
**Branch:** `staging`  
**Mode:** Vendor soft launch and product build phase  
**Guardrail:** No production data or fake production proof. Local seed scripts must be treated as disposable-development helpers only.

## Summary

The seed directory now avoids hardcoded production-style database credentials in the current repo. `seed/seedCategories.js` was changed to use `MONGODB_URI` or a local fallback, and it refuses to run destructive category resets unless `ALLOW_SEED_RESET=true` is explicitly set.

## Seed Inventory

| File | Purpose | Current posture |
| --- | --- | --- |
| `seed/seedCategories.js` | Deletes and inserts sample product/service/food categories | Uses env/local DB URI and requires `ALLOW_SEED_RESET=true` |
| `seed/seedMinorityTypes.js` | Inserts minority type records if none exist | Uses `MONGODB_URI` or local fallback and skips when records exist |
| `seed/insertDummyData.js` | Inserts fake business examples | Marked as local-only dummy data; contains fake contact/business values |
| `seed/migrate.js` | Migration helper using `MONGODB_URI` | Env-driven; no committed credential found in current scan |
| `seed/seedTestS3Upload.js` | Manual S3 upload probe | Uses env var names; should only run against a disposable/local test bucket |
| `seed/testDeleteFile.js` | Manual delete helper | Treat as local/manual only |

## Fixes In This Batch

- Removed a hardcoded MongoDB Atlas connection string from `seed/seedCategories.js`.
- Added `ALLOW_SEED_RESET=true` guard before category `deleteMany` calls.
- Added a local-only warning to `seed/insertDummyData.js`.

## Local Reset Steps

Use only with a local or disposable database:

```bash
set MONGODB_URI=mongodb://localhost:27017/mosaic
set ALLOW_SEED_RESET=true
node seed/seedCategories.js
```

PowerShell equivalent:

```powershell
$env:MONGODB_URI = "mongodb://localhost:27017/mosaic"
$env:ALLOW_SEED_RESET = "true"
node seed/seedCategories.js
```

Unset `ALLOW_SEED_RESET` after the reset:

```powershell
Remove-Item Env:\ALLOW_SEED_RESET
```

## Safety Rules

- Do not run destructive seed scripts against production or shared QA data.
- Do not commit `.env`, real customer/vendor exports, OTPs, passwords, Stripe keys, AWS keys, or live MongoDB credentials.
- Treat any credential that appeared in a tracked seed script or shared artifact as rotated/compromised.
- Use fake names, fake emails, and dummy Stripe IDs only when sample data is needed.

## Verification

- `rg` seed scan found no hardcoded `mongodb+srv`, Stripe key, password, token, or secret values in current `seed/` files after the fix.
- Remaining seed scan hits are AWS env var names in `seed/seedTestS3Upload.js`, not secret values.
- `node seed/seedCategories.js` without `ALLOW_SEED_RESET=true` exits before connecting, confirming the reset guard is active.
- `npm run test:contract` passed on 2026-06-28 after this batch.

Closes #70 when merged with PR validation.
