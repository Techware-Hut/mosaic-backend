# July 6 Cross-Repo Route Contract Trace

Date: July 7, 2026  
Audited SHAs: backend `ad9ddd14`, frontend `b3a86cb4`  
Canonical backend copy; frontend references this file from its audit summary.

---

## Governance Invariants (Verified)

| Check | Frontend | Backend | Tests |
| --- | --- | --- | --- |
| Canonical featured route | `lib/api/featured-products.ts` → `GET /api/featured-products` | `routes/featuredProductRoutes.js` mounted at `/api` | `backend-launch-contract.test.js` |
| Deprecated route absent | 0 app callers; e2e guards only | Not registered | Contract test negative guard |
| Stripe webhook order | N/A | Raw body before `express.json` in `app.js` | Contract test |
| Middleware order | N/A | Not modified in this audit | — |

---

## Alignment Matrix

| Feature | QA # | Frontend caller / file | Backend route | Backend controller | Method | Auth | Request | Response (frontend expects) | Response (backend returns) | Mismatch | Tests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Featured products | — | `ShopProducts.tsx`, `lib/api/featured-products.ts` | `/api/featured-products` | `featuredProducts.controller.getFeaturedProducts` | GET | Public (+ credentials in helper) | `page`, `limit` | `{ products, pagination }` | Same | None | Contract + e2e guards |
| Cart read / pricing | 7–10 | `utils/cartUtils.ts` `getCartDetailedResponse` | `/api/cart` | `cartController.js` | GET | Customer | `deliverySpeed`, `couponCode`, address params | Items, `cartPricing.totalAmount`, `vendorState`, speeds | Same + backend-authoritative pricing | None | `commerce.integration.test.js` |
| Cart quantity update | 8 | `cartUtils.ts` `updateCartItemQuantityById` | `/api/cart/update/:cartItemId` | `cartController.js` | PUT | Customer | `{ quantity }` | Updated cart | Updated cart envelope | None | Integration decrease test |
| Coupon validate | 9 | Cart/buy-now via cart pricing | `/api/discounts/validate`, `/apply`; cart `?couponCode=` | `discountController.js`, `couponDiscount.js` | POST/GET | Customer/owner | Code, cart context | Reject message or discount totals | Backend message + totals | None | `coupon-discount.test.js` |
| Checkout total | 10 | `cart/page.tsx`, `checkout/payment/page.tsx` | `/api/orders/initiate` | `orderController.js` | POST | Customer | Items, address, speed, `expectedTotal` | PaymentIntent amount, order id | Server-recalculated total | None | `order-initiate-coupon.test.js` |
| Local shipping | 7 | `cart/page.tsx`, `cartUtils.ts` | Cart + order initiate | `vendorShipping.js`, cart controller | GET/POST | Customer | Same-state via `vendorState` | `local` chip when eligible | `availableDeliverySpeeds`, costs | None on main | Integration + `cartShipping.test.ts` |
| Product detail | 6–7 | `product/[id]/page.tsx` | `/api/public/product/:productId` | `publicListing.js` | GET | Public | Product id | Description, variants, business state | Raw description + state | Frontend sanitizes description | DTO tests |
| Service list / offerings | 2 | `useServices.ts`, `ProductCard.tsx`, `serviceOfferings.ts` | Service + public list routes | `serviceController.js`, `publicListing.js` | GET | Mixed | Business/list filters | Offering count/names | Parent + child summaries | None | Marketplace integration |
| Service create / edit | 4 | Service forms, `lib/api/services.ts` | `/api/service` POST/PUT | `serviceController.js` | POST/PUT | Business owner | `features[]`, media, children | Persisted service | Persisted document | **Parent create drops features** | Payload contract test |
| Vendor document upload | 12 | `vendorUploadFiles.ts`, business profile | `/api/vendor-onboarding/stage1/upload-url`, `/upload-file` | `vendorOnboardingUpload.controller.js` | GET/POST | Business owner | MIME, file meta | Presign or proxy result | S3 URL/key | Hosted CORS unproven | MIME tests |
| Admin application list | 13 | `vendorOnboardingAdmin.ts`, admin list page | `/api/vendor-onboarding/pending` | `vendorOnboardVerifyStage1.js` | GET | Admin | `?status=` filter | Filtered application array | Filtered with `APPLICATION_STATUS_FILTERS` | None | Pending applications test |
| Admin application detail | 13–14 | `[id]/page.tsx` | `/api/vendor-onboarding/:applicationId` | Admin + vendor controllers | GET | Admin | Application id | Profile, docs, badge, status | Full review payload | Visual clarity needs UAT | Integration |
| Finalize application | 14 | `finalizeVendorApplication()` | `/api/vendor-onboarding/:id/finalize` | `vendorOnboardVerifyStage1.js` | POST | Admin | `decision`, `rejectionReason`, `requiredNextAction`, `adminNotes` | Result + email warning metadata | Same | No separate "request-changes" endpoint | Finalize test |
| Shipment tracking | 11 | Vendor orders UI; customer order page | `/api/orders/ship/:orderId` | `orderController.js` | PUT | Business owner | `trackingId`, `trackingUrl`, `vendorNote` | Shipped order + email metadata | Same | Hosted email unproven | Lifecycle email tests |
| Connect status / messaging | 5, 15 | `stripeConnect.ts`, `vendorOnboardingGuard.ts`, payout pages | `/api/connect/:businessId/status`, `/account-link` | `connectController.js` | GET/POST | Business owner | Business id | Status, onboarding link | Capabilities summary | **Checkout still requires Connect for all types** | `order-initiate-connect.test.js` |
| Image limit enforcement | 1 | Upload components | Product/service create + upload | Product/service controllers | POST/PUT | Business owner | Images array | 400 with plan limit message | Plan-driven max | Copy is frontend | Service publication tests |

---

## Required Payload Fields (July 6)

| Contract | Field | Status | Source |
| --- | --- | --- | --- |
| Cart item | `vendorState` | Implemented | `Business.address.state` on cart enrichment |
| Cart pricing | `availableDeliverySpeeds` incl. `local` | Implemented | `vendorShipping.js` |
| Finalize request | `decision`, `rejectionReason`, `requiredNextAction` | Implemented | Frontend `VendorApplicationFinalizePayload` |
| Service create (non-parent) | `features[]` | Implemented | `createService` |
| Service parent create | `features[]` | **Regression Risk** | Hardcoded `[]` in `createParentService` |
| Admin list | `?status=` | Implemented | `APPLICATION_STATUS_FILTERS` |

---

## Open Contract Decisions

1. **Connect at checkout for service/food** — onboarding skips payout; checkout blocks without Connect (**Pending Client Input**)
2. **Coupon subtotal basis** — backend authoritative; business must confirm rule (**Pending Client Input**)
3. **Request-changes vs reject** — same finalize reject path with `requiredNextAction` (**Documentation Mismatch**)

---

## Verification Commands Run

```text
Backend: npm test (529), test:integration (74), test:contract (20)
rg "/api/products/featured" --glob "*.js"  → runtime absent
rg "featured-products" app.js routes/       → canonical mount confirmed
Frontend: npm run build, test:unit (172), featured route grep → canonical only in app code
```
