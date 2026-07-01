# Upload Security And Storage Lifecycle Audit - 2026-06-28

**Issue:** #71 - File upload security and storage lifecycle audit  
**Branch:** `staging`  
**Mode:** Vendor soft launch and product build phase  
**Guardrail:** No storage provider migration and no secret exposure. This audit documents behavior and logs safe follow-ups.

## Summary

Mosaic backend uses a mix of S3 presigned PUT URLs, API-proxied S3 uploads, direct S3 upload helpers, and a legacy Cloudinary pending-image URL route. Vendor onboarding document uploads have the strongest allowlist: document type validation, MIME normalization, JPEG/PNG/WebP/PDF allowlist, sanitized filenames, user-scoped S3 folders, and five-minute upload contracts. Product, service, and food image presigns validate image MIME types and gallery limits. The generic S3 presign path now normalizes/sanitizes safe media uploads before signing.

## Upload Surface Inventory

| Surface | Route/file | Auth | File/type behavior | Lifecycle |
| --- | --- | --- | --- | --- |
| Vendor onboarding docs | `POST /api/vendor-onboarding/stage1/upload-file`, diagnostic `GET /api/vendor-onboarding/stage1/upload-url`, `controllers/vendorOnboardingUpload.controller.js` | Authenticated verified vendor | Allowed doc types; JPEG/PNG/WebP/PDF allowlist via `utils/vendorOnboardingUploadMimeAllowlist.js`; filename sanitized | `/partners/business/new` and `/partners/business-profile` use the API proxy and save returned `fileUrl`; direct presign remains diagnostic only |
| Product images | `GET /api/product/upload-url`, `GET /api/product/variant-upload-url` | Authenticated business owner | Product doc type allowlist; image MIME normalization/allowlist; gallery quota check for gallery images; response includes upload method/header contract | Client PUTs to S3 and stores returned URL |
| Service images | `GET /api/service/upload-url` | Authenticated business owner | Service doc type allowlist; image MIME normalization/allowlist; gallery quota check for gallery images; response includes upload method/header contract | Client PUTs to S3 and stores returned URL |
| Food images | `GET /api/food/upload-url` | Authenticated business owner | Food doc type allowlist, image MIME normalization/allowlist, gallery quota check, sanitized filenames; response includes upload method/header contract | Client PUTs to S3 and stores returned URL |
| Generic S3 presign | `controllers/s3Controller.js` | Business owner or admin via route | Requires `fileName`/`fileType`; safe media MIME normalization; filename sanitized; user-scoped generic key | Client PUTs to S3 |
| Business create upload | `middlewares/upload.js`, `utils/uploadFile.js` | Business owner route | Multer memory storage, 5 MB max, JPEG/JPG/PNG/WebP only | Server uploads file buffer to S3 |
| Legacy Cloudinary pending image | `POST /api/upload-image`, `routes/uploadImage.js` | Authenticated business owner | Validates Cloudinary image URL format | Stores pending URL for cleanup if not attached |

## Confirmed Controls

- Vendor onboarding MIME allowlist: `image/jpeg`, `image/png`, `image/webp`, `application/pdf`.
- Vendor/business document UI routes share the API-proxied `POST /stage1/upload-file` flow, so browser uploads go to the Mosaic API instead of directly to S3.
- Product/service/food presigned uploads normalize safe image MIME types, including extension fallback when browsers report generic file types.
- Presigned URLs expire after 300 seconds.
- Filenames are sanitized in vendor onboarding, product, service, food, and generic presign controllers.
- Presigned responses include the browser upload contract: `method: "PUT"`, `requiredHeaders.Content-Type`, storage `key`, and 300-second expiry.
- Gallery upload paths enforce subscription gallery limits where implemented.
- Multer direct upload path uses memory storage with a 5 MB limit and image-only filter.

## Logged Follow-Ups

1. Rename or split legacy `deleteCloudinaryFile.js` if it now deletes S3 objects, so storage lifecycle naming is not misleading.
2. Consider extracting product/service/food MIME normalization into one shared helper if those routes are edited again.
3. Run a live S3 CORS/presigned PUT smoke after production domain/env changes, because unit tests do not prove bucket CORS.

## Verification

- Upload route/middleware/source scan covered S3 presign controllers, Multer middleware, Cloudinary pending route, docs, and upload tests.
- Existing relevant proof is documented in `docs/S3_UPLOAD_CORS.md` and `docs/VENDOR_LIFECYCLE.md`.
- `npm run test:contract` passed on 2026-06-28 after this batch.
- `node --test tests/vendor/vendor-onboarding-upload-mime.test.js tests/vendor/listing-tier-limits.test.js tests/service/service-publication-visibility.test.js` passed on 2026-06-28 after this batch.
- No storage provider migration was performed in this batch.

Closes #71 when merged with PR validation.
