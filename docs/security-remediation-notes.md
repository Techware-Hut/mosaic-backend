# Security Remediation Notes

This document tracks the backend security remediation items that have been completed in code or documentation, along with the current verification status.

Secret rotation verification and AWS-side deployment hygiene are intentionally excluded here because they are being handled separately outside this repository.

## Remediation tracker

| ID | Remediation item | Status | Related PR / commit | Verification note |
| --- | --- | --- | --- | --- |
| 1 | Hardcoded secret removed from active auth flow | Complete | [2b9e562](https://github.com/DeveloperTWH/backend/commit/2b9e5624124b400eb38630210385a54111fa0bc2) | Active auth flow now reads the JWT secret from environment configuration. |
| 2 | Public admin registration removed | Complete | [9b57a41](https://github.com/DeveloperTWH/backend/commit/9b57a4129f74ca93cb29de0b0224f7f0e2919ad8) | Public registration flow no longer creates admin users. Protected admin creation flow remains separate. |
| 3 | Google OAuth role assignment locked server-side | Complete | [1ab5366](https://github.com/DeveloperTWH/backend/commit/1ab53662b886d7b615c06c39561e593a74230a50) | Client-supplied role escalation through OAuth was removed. New Google users default safely on the server. |
| 4 | Vendor verification test bypass removed | Complete | [73a19b3](https://github.com/DeveloperTWH/backend/commit/73a19b365e8240f7215f7d7eb9121b3d5fdb81b3) | Manual payment bypass route and controller bypass path were removed. |
| 5 | Payment amount derived server-side | Complete | [46d2466](https://github.com/DeveloperTWH/backend/commit/46d2466b65652092c8ef1c7dd83830d4477e1338) | Order payment amount is derived from persisted order data instead of trusting client input. |
| 6 | Auth endpoints rate-limited | Complete | `e5672ff241b5b381c15fde5b49fc41f217c687c2` | Registration, login, OTP verify, and OTP resend routes are rate-limited. |
| 7 | OTP logging removed from active code | Complete in workspace, pending commit | Pending current workspace commit | Removed active OTP-value logging from registration, resend, login-triggered resend, and password-reset flows in `controllers/userController.js`. |
| 8 | Legacy insecure cookie/session examples removed from comments | Complete in workspace, pending commit | Pending current workspace commit | Removed stale commented cookie/session snippets from `controllers/userController.js` and outdated legacy cookie notes from `controllers/authController.js`. |
| 9 | Cookie/session behavior standardized with shared helper | Complete | [96d79a8](https://github.com/DeveloperTWH/backend/commit/96d79a8) and [c796fde](https://github.com/DeveloperTWH/backend/commit/c796fde) | Active auth, OTP, and logout cookie behavior is centralized in `utils/cookieHelper.js`. |
| 10 | Canonical Stripe webhook path cleaned up | Complete | [d6aed10](https://github.com/DeveloperTWH/backend/commit/d6aed10b3fa5392980339cdae88d3a996aa2268d) | Canonical order-payment webhook path is defined and duplicate legacy paths were removed from active routing. |
| 11 | Duplicate payment/webhook handlers documented | Complete | [faf432f](https://github.com/DeveloperTWH/backend/commit/faf432f3562a9e8473dcb8adc13caf20b33d52b0) | Stripe handler ownership and endpoint purposes are documented for audit review. |
| 12 | Backend README created | Complete | [18554f2](https://github.com/DeveloperTWH/backend/commit/18554f2c28738f8b21a8f91ca36e2ab1f46325e4) | Root README documents architecture, setup, environment variables, and command usage. |
| 13 | Environment/setup checklist created | Complete | [0f7b7a0](https://github.com/DeveloperTWH/backend/commit/0f7b7a0976a4b79818fc53c369037706ef1f57c0) | `.env.example` and `SETUP.md` document required environment and setup expectations. |
| 14 | Staging workflow documented | Complete in workspace, pending commit | Pending current workspace commit | Added `STAGING.md` documenting the `staging` branch workflow, current lack of a hosted staging environment, and pre-production validation requirements. |
| 15 | Deployment process documented | Complete in workspace, pending commit | Pending current workspace commit | Added `DEPLOYMENT.md` covering release flow, responsibilities, smoke tests, and rollback steps. |
| 16 | Tracking document cleaned up and mapped to remediation items | Complete in workspace, pending commit | Pending current workspace commit | This tracker now includes a status, related commit reference, and verification note for each remediation item. |

## Current code and documentation evidence

- [controllers/userController.js](../controllers/userController.js)
- [controllers/authController.js](../controllers/authController.js)
- [README.md](../README.md)
- [SETUP.md](../SETUP.md)
- [STAGING.md](../STAGING.md)
- [DEPLOYMENT.md](../DEPLOYMENT.md)

## Remaining external follow-up

- Add PR links after the current workspace changes are committed and pushed.
- Capture live deployment and webhook evidence after the next release.
- Track secret rotation verification separately with the deployment or AWS owner.
