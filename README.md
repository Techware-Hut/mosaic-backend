# Mosaic Biz Hub Backend

Node.js/Express backend for Mosaic Biz Hub. This service exposes marketplace, onboarding, subscription, Stripe, admin, media upload, and notification APIs backed by MongoDB.

## Stack

- Node.js
- Express
- MongoDB with Mongoose
- Stripe
- AWS S3
- Nodemailer

## Project structure

| Path | Responsibility |
| --- | --- |
| `index.js` | Process bootstrap, env loading, database connection, HTTP listener |
| `app.js` | Express app setup, middleware, route mounting |
| `config/` | Database connection and configuration helpers |
| `routes/` | HTTP route definitions and route grouping |
| `controllers/` | Request handlers and business logic |
| `models/` | Mongoose schemas and data access layer |
| `middlewares/` | Authentication, authorization, and request middleware |
| `utils/` | Mailers, uploads, payments, PDF helpers, and shared utilities |
| `helpers/` | Focused helper modules such as Stripe plan helpers |
| `docs/` | Operational and architecture documentation — start at [docs/README.md](docs/README.md) |
| `jobs/` | Background job entrypoints |
| `services/`, `validators/`, `lib/` | Supporting service code, validation, and library logic |

## Architecture overview

The application follows a conventional Express layered structure:

1. `index.js` loads environment variables, connects to MongoDB, and starts the server.
2. `app.js` configures transport middleware (CORS, cookies, JSON parsing). `express-mongo-sanitize` and `xss-clean` are imported but not currently mounted — see [launch-readiness-report.md](docs/launch-readiness-report.md) §8.
3. Route modules in `routes/` map URL namespaces to controller functions.
4. Controllers orchestrate validation, Stripe/AWS/mail integrations, and persistence through Mongoose models.
5. Models in `models/` define the MongoDB document structure for users, businesses, orders, subscriptions, onboarding, and related entities.

Primary functional areas in the codebase:

- Auth and users: login, registration, OAuth-related flows, cookies, JWT-based auth
- Marketplace: businesses, products, services, food listings, categories, reviews
- Customer flows: cart, wishlist, enquiries, bookings, orders
- Admin flows: CMS, testimonials, FAQs, blogs, business verification, product moderation
- Payments and subscriptions: Stripe payment intents, checkout sessions, subscriptions, webhooks, billing portal, Connect
- Media and documents: AWS S3 uploads and signed upload/download workflows

## Prerequisites

- Node.js 18+ recommended
- npm
- MongoDB connection string
- Stripe account and webhook secrets for payment/subscription flows
- AWS credentials if upload features are used
- SMTP-compatible mailbox credentials for email features

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file in the project root.

3. Add the required environment variables from the sections below.

4. Start the development server:

```bash
npm run dev
```

5. The API starts on `PORT` if defined, otherwise `3001`.

## Commands

| Command | Description |
| --- | --- |
| `npm install` | Install project dependencies |
| `npm run dev` | Start the API with `nodemon` |
| `npm start` | Start the API with `node index.js` |
| `npm test` | Run automated tests (`node --test tests/**/*.test.js`, 57 cases) — see [docs/TEST_MATRIX.md](docs/TEST_MATRIX.md) |

## Operational docs

**Documentation home:** [docs/README.md](docs/README.md) — full index, read-first guides, and maintenance rules.

Key entry points:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — backend map for contributors and LLMs
- [docs/API_SURFACE.md](docs/API_SURFACE.md) — HTTP route map, auth boundaries, smoke notes
- [docs/PRODUCTION_RUNBOOK.md](docs/PRODUCTION_RUNBOOK.md) — production deploy, smoke, rollback, sign-off
- [docs/TEST_MATRIX.md](docs/TEST_MATRIX.md) — automated tests vs manual smoke mapping
- [docs/DECISION_REGISTER.md](docs/DECISION_REGISTER.md) — MVP decisions, deferrals, and launch assumptions
- [SETUP.md](SETUP.md) · [STAGING.md](STAGING.md) · [DEPLOYMENT.md](DEPLOYMENT.md)

## Release workflow (MVP)

1. Work on a feature branch; open PR to `staging`.
2. Complete integration checklist in [STAGING.md](STAGING.md) (code review, local boot — no hosted staging).
3. Open PR `staging` → `main`; required reviewers approve.
4. Deploy `main` to AWS Elastic Beanstalk; follow [docs/PRODUCTION_RUNBOOK.md](docs/PRODUCTION_RUNBOOK.md) for smoke and sign-off.
5. Record proof in [docs/production-proof-pack-template.md](docs/production-proof-pack-template.md).

Hosted staging is deferred — see [docs/hosted-staging-decision.md](docs/hosted-staging-decision.md).

## Environment variables

Add only the values needed for the features you plan to run locally. Some flows are optional, but core app startup still needs database access and any integrations exercised by your route usage.

### Core runtime

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | Optional | HTTP port, defaults to `3001` |
| `NODE_ENV` | Optional | Runtime mode used in auth/cookie behavior |
| `MONGODB_URI` | Yes | MongoDB connection string |
| `FRONTEND_URL` | Recommended | Frontend base URL used in CORS and generated links |
| `JWT_SECRET` | Yes | JWT signing/verification secret |
| `COOKIE_DOMAIN` | Optional | Cookie domain override; defaults to `.mosaicbizhub.com` in production and unset locally |
| `COOKIE_SECURE` | Optional | Cookie `Secure` override; defaults to `true` in production and `false` locally |
| `COOKIE_SAMESITE` | Optional | Cookie `SameSite` override; defaults to `none` when secure cookies are enabled, otherwise `lax` |

### Stripe

| Variable | Required | Purpose |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Yes for payment features | Stripe API secret used across payment, checkout, subscription, refund, and Connect flows |
| `STRIPE_ORDER_WEBHOOK_SECRET` | Yes for `/api/webhooks/stripe` | Signature verification for the canonical order-payment webhook |
| `STRIPE_BUSINESS_DRAFT_WEBHOOK_SECRET` | Yes for `/api/stripe/webhook` | Signature verification for business draft checkout completion and Connect account sync |
| `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` | Yes for `/api/subscription/webhook` | Signature verification for subscription billing webhook |
| `STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET` | Yes for `/api/vendor-onboarding/webhook/payment` | Signature verification for vendor onboarding verification payment webhook |
| `STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET` | Yes for `/api/stripe/payment/webhook` | Signature verification for order email/post-payment webhook flow |
| `PLATFORM_FEE_CENTS` | Optional but recommended for order flow | Platform fee used in Stripe payment calculations |
| `BILLING_PORTAL_RETURN_URL` | Optional | Explicit billing portal return URL; falls back to frontend-based behavior where applicable |
| `CONNECT_RETURN_PATH` | Optional | Relative return path for Stripe Connect onboarding |
| `CONNECT_REFRESH_PATH` | Optional | Relative refresh path for Stripe Connect onboarding |
| `CONNECT_RETURN_URL` | Optional | Absolute return URL override for Stripe Connect |
| `CONNECT_REFRESH_URL` | Optional | Absolute refresh URL override for Stripe Connect |

See [docs/security-remediation-notes.md](docs/security-remediation-notes.md) for current remediation status, including Stripe route, handler, and secret ownership.

### AWS S3

| Variable | Required | Purpose |
| --- | --- | --- |
| `AWS_REGION` | Yes for uploads | AWS region for S3 client configuration |
| `AWS_ACCESS_KEY_ID` | Yes for uploads | AWS access key for S3 access |
| `AWS_SECRET_ACCESS_KEY` | Yes for uploads | AWS secret key for S3 access |
| `AWS_S3_BUCKET` | Yes for uploads | S3 bucket name for product, service, food, and onboarding uploads |

### Email and notifications

| Variable | Required | Purpose |
| --- | --- | --- |
| `MAIL_USER` | Yes for email features | SMTP sender/login identity used by mail utilities |
| `MAIL_PASSWORD` | Yes for email features | SMTP credential |
| `ADMIN_EMAIL` | Recommended | Admin notification recipient for onboarding, category requests, and contact inquiries |
| `SUPPORT_EMAIL` | Optional | Support/contact email used in outbound templates |
| `APP_NAME` | Optional | Branding label used in some email content |
| `APP_URL` | Optional | Base URL used in order-related email links |

### Google OAuth (required at boot)

| Variable | Required | Purpose |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | Yes | OAuth; `authController.js` throws if missing at module load |
| `GOOGLE_CLIENT_SECRET` | Yes | OAuth client secret |
| `API_BASE_URL` | Yes | Public API base for OAuth callback (e.g. `http://localhost:3001` locally) |
| `GOOGLE_GEOCODING_API_KEY` | Optional | Geocoding and Google place-related lookups |

### PayPal

| Variable | Required | Purpose |
| --- | --- | --- |
| `PAYPAL_CLIENT_ID` | Optional | PayPal verification utility |
| `PAYPAL_CLIENT_SECRET` | Optional | PayPal verification utility |

### PDF / headless browser

| Variable | Required | Purpose |
| --- | --- | --- |
| `PUPPETEER_EXECUTABLE_PATH` | Optional | Custom Chromium/Chrome executable path for PDF generation environments |

### Debug / diagnostics

| Variable | Required | Purpose |
| --- | --- | --- |
| `LISTING_DEBUG` | Optional | Enables listing debug behavior in middleware |

## Local development notes

- `express.json()` is mounted after raw Stripe webhook endpoints in `app.js`. Keep that ordering intact so Stripe signature verification continues to work.
- The root health-style route is `GET /` and returns a simple JSON message.
- The codebase uses a flat JavaScript Express structure, not TypeScript and not a formal service container.
- Create a `.env` file in the project root (the app loads `.env` only — not `.env.local`).
- `npm test` runs 57 mocked unit/integration-style tests locally; passing does **not** replace post-deploy smoke on [production-smoke-checklist.md](docs/production-smoke-checklist.md).

## Key route groups

| Prefix | Area |
| --- | --- |
| `/api/auth` | Authentication |
| `/api/users` | User APIs |
| `/api/business` | Business APIs |
| `/api/product` | Product APIs |
| `/api/service` | Service APIs |
| `/api/food` | Food APIs |
| `/api/orders` | Order APIs |
| `/api/payments` | Payment intent creation |
| `/api/webhooks` | Canonical order-payment Stripe webhook |
| `/api/subscriptions` | Subscription APIs |
| `/api/stripe` | Stripe checkout and webhook flows |
| `/api/connect` | Stripe Connect onboarding |
| `/api/vendor-onboarding` | Vendor onboarding APIs |
| `/admin/*` and `/api/admin/*` | Admin operations |

## Related documentation

- [docs/security-remediation-notes.md](docs/security-remediation-notes.md)

## Deployment notes

- Ensure all Stripe webhook endpoints in the deployed environment use the correct secrets documented above.
- Confirm `FRONTEND_URL` is set correctly for CORS and link generation.
- Configure AWS and mail credentials before enabling upload or notification flows.
- For production, verify MongoDB, Stripe, SMTP, and S3 credentials in the deployment environment rather than relying on a local `.env`.
