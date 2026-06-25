# Client Decision Register

Date: 2026-06-24
Decision owner: Bryan

No agent may decide these silently.

| Decision | Current system behavior | Options | Required before launch? | Status |
| --- | --- | --- | --- | --- |
| Food default price ceiling | Backend defaults `/api/food/list` to `0-200` unless `price=all` is sent | Keep default, remove default, or make frontend always send `price=all` | Yes, if higher-priced food listings are expected at launch | PRODUCT DECISION |
| Stripe Connect visibility by vendor type | Connect is business-scoped, not vertical-scoped | Show to all vendors, only product vendors, or only vendors with payout-required listings | Yes | PRODUCT DECISION |
| Dynamic available-state selector | Filters support state/country, but no dedicated endpoint lists only locations with visible listings | Static list, backend metadata endpoint, or defer | No, unless UX requires it at launch | PRODUCT DECISION |
| Single-vendor versus multi-vendor cart | Cart/order flow needs final product decision for mixed-vendor cart expectations | Force single-vendor cart, support multi-vendor split orders, or defer mixed-cart checkout | Yes for checkout QA | PRODUCT DECISION |
| Return/refund/dispute launch scope | Backend has refund/return/dispute-adjacent behavior, but live launch policy is not finalized | Launch with basic policy pages, enable workflows, or defer workflows | Yes for policy/UAT | PRODUCT DECISION |
| Seed/demo data | Public marketplace proof depends on approved active listings | Seed curated demo data, use real vendor data, or launch sparse | Yes for public launch polish | PRODUCT DECISION |
| Launch content | CMS/static content needs final editorial approval | Approve current, update before launch, or launch with known gaps | Yes | PRODUCT DECISION |
| Deferred integrations | Future integrations are outside cutover | Explicitly defer or block launch | No if documented | PRODUCT DECISION |
