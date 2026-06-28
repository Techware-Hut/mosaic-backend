# Upload Security And Storage Lifecycle Audit - 2026-06-28

**Issue:** #71 - File upload security and storage lifecycle audit  
**Branch:** `staging`  
**Mode:** Vendor soft launch and product build phase  
**Guardrail:** No storage provider migration and no secret exposure. This audit documents behavior and logs safe follow-ups.

## Summary

Mosaic backend uses a mix of S3 presigned PUT URLs, direct S3 upload helpers, and a legacy Cloudinary pending-image URL route. Vendor onboarding document uploads have the strongest allowlist: document type validation, MIME normalization, JPEG/PNG/WebP/PDF allowlist, sanitized filenames, user-scoped S3 folders, and five-minute presigned URLs. Product and service image presigns also validate image MIME types and gallery limits. Food and generic S3 presign paths should be aligned with the same MIME normalization pattern in a future hardening PR.

## Upload Surface Inventory

| Surface | Route/file | Auth | File/type behavior | Lifecycle |
| --- | --- | --- | --- | --- |
| Vendor onboarding docs | `GET /api/vendor-onboarding/stage1/upload-url`, `controllers/vendorOnboardingUpload.controller.js` | Authenticated verified vendor | Allowed doc types; JPEG/PNG/WebP/PDF allowlist via `utils/vendorOnboardingUploadMimeAllowlist.js`; filename sanitized | Client PUTs to S3, saves returned `fileUrl` in onboarding draft |
| Product images | `GET /api/product/upload-url`, `GET /api/product/variant-upload-url` | Authenticated | Product doc type allowlist; image MIME allowlist; gallery quota check for gallery images | Client PUTs to S3 and stores returned URL |
| Service images | `GET /api/service/upload-url` | Authenticated | Service doc type allowlist; image MIME allowlist; gallery quota check for gallery images | Client PUTs to S3 and stores returned URL |
| Food images | `GET /api/food/upload-url` | Authenticated | Food doc type allowlist and gallery quota check; MIME allowlist should be aligned with product/service | Client PUTs to S3 and stores returned URL |
| Generic S3 presign | `controllers/s3Controller.js` | Business owner or admin via route | Requires `fileName`/`fileType`; should add centralized MIME normalization and filename sanitization | Client PUTs to S3 |
| Business create upload | `middlewares/upload.js`, `utils/uploadFile.js` | Business owner route | Multer memory storage, 5 MB max, JPEG/JPG/PNG/WebP only | Server uploads file buffer to S3 |
| Legacy Cloudinary pending image | `POST /api/upload-image`, `routes/uploadImage.js` | Authenticated business owner | Validates Cloudinary image URL format | Stores pending URL for cleanup if not attached |

## Confirmed Controls

- Vendor onboarding MIME allowlist: `image/jpeg`, `image/png`, `image/webp`, `application/pdf`.
- Product/service presigned uploads validate image MIME types before issuing URLs.
- Presigned URLs expire after 300 seconds.
- Filenames are sanitized in vendor onboarding, product, service, and food presign controllers.
- Gallery upload paths enforce subscription gallery limits where implemented.
- Multer direct upload path uses memory storage with a 5 MB limit and image-only filter.

## Logged Follow-Ups

1. Align `foodController.getFoodUploadUrl` with the same normalized MIME allowlist pattern used by product/service/vendor onboarding.
2. Align `s3Controller.getPresignedUrl` with centralized MIME normalization and filename sanitization before broadening its use.
3. Rename or split legacy `deleteCloudinaryFile.js` if it now deletes S3 objects, so storage lifecycle naming is not misleading.
4. Add focused tests for food/generic S3 MIME rejection where practical.
5. Run a live S3 CORS/presigned PUT smoke after production domain/env changes, because unit tests do not prove bucket CORS.

## Verification

- Upload route/middleware/source scan covered S3 presign controllers, Multer middleware, Cloudinary pending route, docs, and upload tests.
- Existing relevant proof is documented in `docs/S3_UPLOAD_CORS.md` and `docs/VENDOR_LIFECYCLE.md`.
- `npm run test:contract` passed on 2026-06-28 after this batch.
- `node --test tests/vendor/vendor-onboarding-upload-mime.test.js tests/vendor/listing-tier-limits.test.js tests/service/service-publication-visibility.test.js` passed on 2026-06-28 after this batch.
- No storage provider migration was performed in this batch.

Closes #71 when merged with PR validation.
