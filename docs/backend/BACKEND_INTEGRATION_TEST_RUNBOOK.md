# Backend Integration Test Runbook

**Repo:** `Techware-Hut/mosaic-backend`  
**Issue:** [#172 — Isolated integration test suite](https://github.com/Techware-Hut/mosaic-backend/issues/172)  
**Epic:** Cross-repo workflow reliability (#162)

---

## Purpose

HTTP-level integration tests exercise the real Express app (`app.js`) against a **disposable in-memory MongoDB**. External providers (Stripe, SMTP/mailer) are stubbed at module boundaries only.

Production, staging, and shared development databases are **never** used.

---

## Commands

```bash
npm test
npm run test:contract
npm run test:integration
```

Integration tests run with `--test-concurrency=1` to share one MongoMemoryServer instance safely.

---

## Database isolation

| Item | Value |
|------|--------|
| Engine | `mongodb-memory-server` (ephemeral) |
| URI | Set at runtime to `process.env.MONGODB_URI` |
| Cleanup | `deleteMany({})` on all collections between tests |
| Teardown | Memory server stopped after each test file completes |

---

## External services stubbed

| Provider | Stub location | Notes |
|----------|---------------|-------|
| Stripe | `tests/integration/helpers/providerStubs.js` | No live API calls |
| SMTP / mailer | `tests/integration/helpers/providerStubs.js` | OTP captured for verification tests |
| AWS S3 / Cloudinary | Dummy env vars only | Upload routes not exercised in baseline suite |

---

## Environment variables (names only)

Set automatically by the harness — do not point at real infrastructure:

- `MONGODB_URI`
- `JWT_SECRET`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `FRONTEND_URL`
- `CORS_ORIGINS`
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET`
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- `SENTRY_ENABLED=false` (Sentry disabled)

Optional live credential variables are **not** used by integration tests.

---

## Layout

| Path | Role |
|------|------|
| `tests/integration/setup/harness.js` | Memory Mongo, app bootstrap, reset/teardown |
| `tests/integration/helpers/client.js` | Supertest agent helpers |
| `tests/integration/helpers/factories.js` | User/vendor/admin seeding |
| `tests/integration/helpers/providerStubs.js` | Stripe + mailer stubs |
| `tests/integration/helpers/otpCapture.js` | Controlled OTP fixture capture |
| `tests/integration/*.integration.test.js` | Domain coverage specs |

---

## CI

GitHub Actions job **Test** (`.github/workflows/ci.yml`) runs:

1. `npm test`
2. `npm run test:contract`
3. `npm run test:integration`

No MongoDB service container is required.

---

## Rollback

Remove `mongodb-memory-server` and `supertest` devDependencies, delete `tests/integration/`, remove `test:integration` script and CI step. Unit/contract tests remain unchanged.

---

## Related docs

- [BACKEND_DOCUMENTATION_EVIDENCE_LOG.md](BACKEND_DOCUMENTATION_EVIDENCE_LOG.md)
- [BACKEND_LAUNCH_CONTRACT_VERIFICATION.md](BACKEND_LAUNCH_CONTRACT_VERIFICATION.md)
