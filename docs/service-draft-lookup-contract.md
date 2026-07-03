# Service Draft Lookup Contract

Status: launch corrective fix, July 3, 2026.

This contract separates vendor-owned draft lookup from public service lookup. It is scoped to service listing save/publish behavior and does not change uploads, Stripe, checkout, payouts, subscriptions, webhooks, or middleware ordering.

## Routes

| Purpose | Method | Route | Auth | Visibility |
| --- | --- | --- | --- | --- |
| Vendor draft lookup by business | GET | `/api/service/private/business/:businessId` | `authenticate`, `isBusinessOwner` | Returns the current vendor's parent service whether published or unpublished |
| Public service lookup by service or business | GET | `/api/service/business-service/:id` | Public | Returns only publicly visible published services for active businesses |
| Parent draft create | POST | `/api/service/parent` | `authenticate`, `isBusinessOwner` | Creates an unpublished parent service with no child offerings |
| Parent update/publish | PUT | `/api/service/:id` | `authenticate`, `isBusinessOwner` | Updates the vendor-owned parent service by service id |
| Child offering add | POST | `/api/service/add-child-services` | `authenticate`, `isBusinessOwner` | Adds child offerings to the parent service |

## Publish Rule

Saving a draft may persist parent service details and media without child offerings.

Publishing requires at least one valid child service offering with:

- `name`
- `price`
- `durationMinutes` or parseable `duration`

If publish is requested without child offerings, the backend returns HTTP 400 with:

```json
{
  "success": false,
  "message": "Add at least one service offering before publishing.",
  "error": "Add at least one service offering before publishing.",
  "fieldErrors": {
    "services": "Add at least one service offering before publishing.",
    "isPublished": "Add at least one service offering before publishing."
  }
}
```

## Regression Guard

The add-service frontend must not use `GET /api/service/business-service/:businessId` for vendor draft detection. That route is public and intentionally hides unpublished services.
