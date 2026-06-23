# Backend Error Response Contract

**Issue:** #46
**Last updated:** 2026-06-23

## Standard Envelope

Representative backend errors should move toward this shape:

```json
{
  "success": false,
  "message": "Human-safe summary",
  "code": "STABLE_MACHINE_CODE",
  "requestId": "optional-request-id",
  "fieldErrors": {
    "fieldName": "Field-safe message"
  }
}
```

Some legacy vendor/product clients still expect `error`. New helper calls may include `error` only when backward compatibility requires it.

## Helper

`utils/apiError.js` now centralizes:

- `buildErrorPayload`
- `sendError`
- `sendUnauthorized`
- `sendForbidden`
- `sendNotFound`
- `sendValidationError`

The helper adds `success: false`, stable `code`, optional `requestId`, and normalized `fieldErrors`.

## Applied In This Pass

| Surface | Representative coverage |
| --- | --- |
| Auth middleware | 401 token/session failures now include stable codes and request IDs. |
| Admin guard | 403 admin-only failures now include `success: false`, `code`, and `requestId`. |
| Business owner/vendor guards | 403 vendor role, OTP, blocked/deleted, and stage-1 verification failures use the helper. |
| Product owner reads/updates | 403/404/500 owner product responses preserve legacy `error` while adding the standard fields. |

## Guardrails

- Do not include raw exception messages in public 500 responses.
- Do not include passwords, OTPs, tokens, Stripe secrets, payment intent client secrets, database URLs, or raw uploaded document metadata.
- Preserve existing `message` strings unless a frontend change is coordinated.
- Preserve legacy `error` only where existing clients or tests already depend on it.

## Remaining Work

- Convert more controllers opportunistically as they are touched.
- Add field-level envelopes to express-validator routes after frontend forms are aligned.
- Audit payment and webhook errors separately because those paths have Stripe-specific leakage risks.
