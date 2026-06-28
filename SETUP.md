# Backend Setup Checklist

This checklist is for bringing up the Mosaic Biz Hub backend locally or preparing a new environment safely.

## Quick start

1. Install dependencies.

```bash
npm install
```

2. Create a local environment file from the example.

```bash
copy .env.example .env
```

The application loads **`.env` only** (not `.env.local`). On Windows, if `mongodb+srv://` fails with `querySrv ECONNREFUSED`, change system DNS to `8.8.8.8` / `1.1.1.1` or use a standard (non-SRV) MongoDB URI.

If you are on macOS or Linux, use:

```bash
cp .env.example .env
```

3. Fill in `.env` with real values for the features you need.

4. Start the server.

```bash
npm run dev
```

5. Confirm the API is up by visiting `GET /` on `http://localhost:3001` unless you changed `PORT`.

## Setup checklist

### Core application

- Install Node.js and npm.
- Confirm `node` and `npm` are available in your shell.
- Set `MONGODB_URI`.
- Set `JWT_SECRET`.
- Set `FRONTEND_URL`.
- Set `PORT` if you do not want the default `3001`.
- Set `COOKIE_DOMAIN`, `COOKIE_SECURE`, and `COOKIE_SAMESITE` only if you need to override the default environment-based cookie behavior.

### Stripe

- Set `STRIPE_SECRET_KEY`.
- Set `STRIPE_ORDER_WEBHOOK_SECRET` for the canonical order-payment webhook at `/api/webhooks/stripe`.
- Set `STRIPE_BUSINESS_DRAFT_WEBHOOK_SECRET` for `/api/stripe/webhook`.
- Set `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` for `/api/subscription/webhook`.
- Set `STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET` for `/api/vendor-onboarding/webhook/payment`.
- Set `STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET` for `/api/stripe/payment/webhook`.
- Set `PLATFORM_FEE_CENTS` if your order/payment flow uses platform fees.
- Set Connect return/refresh URLs or paths if Stripe Connect onboarding is used.

### AWS uploads

- Set `AWS_REGION`.
- Set `AWS_ACCESS_KEY_ID`.
- Set `AWS_SECRET_ACCESS_KEY`.
- Set `AWS_S3_BUCKET`.

### Email

- Set `MAIL_USER` (Gmail address used as SMTP login and From header).
- Set `MAIL_PASSWORD` to a [Google App Password](https://support.google.com/accounts/answer/185833) — not your normal Google account password. Requires 2-Step Verification on the Google account.
- Set `ADMIN_EMAIL`.
- Set `SUPPORT_EMAIL` if you want support links in emails.
- **Local inbox check:** After starting the server, register a test account with a real inbox you control. Confirm the verification email arrives within a few minutes. Do not log or paste OTP values.

### Optional integrations

- Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `API_BASE_URL` — **required for server boot** (see README).
- Set `GOOGLE_GEOCODING_API_KEY` for Google geocoding/place flows.
- Set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` only if PayPal verification utilities are used.
- Set `PUPPETEER_EXECUTABLE_PATH` only when your environment needs a custom Chromium path.
- Set Cloudinary variables only if that storage path is still used in your environment.

## Verification checklist

- Run `npm run dev`.
- Confirm the server logs show a successful MongoDB connection.
- Confirm the server logs show the HTTP listener started on the expected port.
- Open `http://localhost:3001/` and confirm you receive the JSON health response.
- If using Stripe, send a test event only after webhook secrets are configured correctly for the target endpoint.

## Commands

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Run with nodemon for development |
| `npm start` | Run with Node.js |
| `npm test` | Run the local non-integration test suite with Node's built-in runner; see [docs/TEST_MATRIX.md](docs/TEST_MATRIX.md) |

## Local Seed Reset Guard

`seed/seedCategories.js` deletes and recreates sample category records. It now refuses to run unless `ALLOW_SEED_RESET=true` is set. Use only against a local or disposable database:

```powershell
$env:MONGODB_URI = "mongodb://localhost:27017/mosaic"
$env:ALLOW_SEED_RESET = "true"
node seed/seedCategories.js
Remove-Item Env:\ALLOW_SEED_RESET
```

## Environment file guidance

- Do not commit your real `.env`.
- Keep `.env.example` updated when new required variables are introduced.
- Use distinct Stripe webhook secrets per deployed endpoint where possible.
- If you rotate credentials, update the deployment environment and local `.env`, not `.env.example`.

## Related docs

- [README.md](README.md)
- [STAGING.md](STAGING.md)
- [DEPLOYMENT.md](DEPLOYMENT.md)
- [docs/README.md](docs/README.md) — documentation index
- [docs/TEST_MATRIX.md](docs/TEST_MATRIX.md)
- [docs/launch-readiness-report.md](docs/launch-readiness-report.md)
- [docs/security-remediation-notes.md](docs/security-remediation-notes.md)

## Deployment notes

- Production should inject secrets through the deployment platform or secret manager, not by reusing a local developer `.env`.
- Stripe webhook endpoints must be configured with the matching secret for each deployed route.
- Any credentials already exposed in an existing tracked or shared `.env` should be treated as compromised and rotated.
