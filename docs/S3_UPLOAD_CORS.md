# S3 Presigned Upload CORS — Production Verification

**Issue:** Vendor onboarding browser upload fails when `PUT`ing directly to S3 pre-signed URL (not Express API CORS).  
**Evidence date:** 2026-06-19 (UTC)  
**Production API:** `https://api.mosaicbizhub.com`  
**Production bucket (from presigned URL host):** `mosaic-biz-hub` · region `us-east-1`

No AWS keys, signed URLs, ETag values, cookies, JWTs, or env values in this document.

---

## Executive verdict

**S3 upload CORS: PASS**

After bucket CORS was updated on `mosaic-biz-hub`, production probes confirm browser-allowed origins, successful OPTIONS preflight, and successful presigned PUT for vendor onboarding Stage 1 documents.

---

## This is not Express CORS

| Layer | Applies to | Config location |
| --- | --- | --- |
| **Express CORS** | `https://api.mosaicbizhub.com` | [`utils/corsOrigins.js`](../utils/corsOrigins.js), [`app.js`](../app.js) |
| **S3 bucket CORS** | `https://{bucket}.s3.{region}.amazonaws.com/...` | AWS S3 Console → bucket → Permissions → CORS |

See also [`docs/CORS_PRODUCTION_SMOKE_PROOF.md`](CORS_PRODUCTION_SMOKE_PROOF.md) for API CORS only.

---

## Backend presign flow (unchanged)

| Item | Detail |
| --- | --- |
| Route | `GET /api/vendor-onboarding/stage1/upload-url` |
| Guards | `authenticate` + `requireVerifiedVendor` |
| Controller | [`controllers/vendorOnboardingUpload.controller.js`](../controllers/vendorOnboardingUpload.controller.js) |
| Query params | `fileName`, `fileType`, `documentType` |
| Response | `{ success, uploadUrl, fileUrl, documentType, key }` |
| Signed fields | `PutObjectCommand` includes `ContentType` (must match browser PUT header) |
| Key prefix | `vendor-onboarding/stage1/{userId}/...` |
| Expiry | 300 seconds |

**Allowed MIME types:** JPEG, PNG, WebP, PDF — [`utils/vendorOnboardingUploadMimeAllowlist.js`](../utils/vendorOnboardingUploadMimeAllowlist.js)

**Required env var names (values in EB only):** `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET`

---

## Required S3 bucket CORS policy

Apply on bucket **`mosaic-biz-hub`** (must match production `AWS_S3_BUCKET`):

```json
[
  {
    "AllowedOrigins": [
      "https://mosaic-biz-frontend-launch.vercel.app",
      "https://mosaicbizhub.com",
      "https://app.mosaicbizhub.com"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

**Console:** S3 → `mosaic-biz-hub` → Permissions → Cross-origin resource sharing (CORS)  
**CLI (release owner):** `aws s3api get-bucket-cors --bucket mosaic-biz-hub --region us-east-1`

---

## Live verification results (2026-06-19)

Probes used credentialed vendor session against production API; signed URL query strings were **not** recorded.

**Domain note:** this historical proof predates the root-domain correction. The bucket policy above now includes the canonical apex origin; apex S3 upload CORS still needs a fresh browser/probe verification after DNS and frontend env cutover.

### API presign

| Step | Expected | Result |
| --- | --- | --- |
| `GET /api/vendor-onboarding/stage1/upload-url` | 200 | **PASS** — 200, `success: true`, `fileUrl` present |
| Response host | `mosaic-biz-hub.s3.us-east-1.amazonaws.com` | **PASS** |

### S3 CORS preflight (OPTIONS)

| Origin | Expected ACAO | HTTP | Result |
| --- | --- | --- | --- |
| `https://mosaic-biz-frontend-launch.vercel.app` | exact match | **200** | **PASS** |
| `https://app.mosaicbizhub.com` | exact match | **200** | **PASS** |

Observed on launch origin (sanitized): `Access-Control-Allow-Methods` includes PUT; `Access-Control-Expose-Headers` includes ETag.

### S3 presigned PUT

| Check | Expected | Result |
| --- | --- | --- |
| PUT with signed `Content-Type: application/pdf` | 200 | **PASS** |
| ETag response header | present | **PASS** |

### Frontend form state

| Check | Status |
| --- | --- |
| Browser stores `fileUrl` (not `uploadUrl`) in onboarding form | **Manual** — confirm in DevTools / UI after re-test on launch frontend |

---

## Frontend upload contract

1. `GET /api/vendor-onboarding/stage1/upload-url?fileName=...&fileType={file.type}&documentType=...` with vendor cookies.
2. `PUT` to `uploadUrl` with body = raw file bytes (not `multipart/form-data`).
3. Header `Content-Type` must **exactly** match the `fileType` query param sent to the API (backend signs this into the URL).
4. Persist **`fileUrl`** from the API response for draft/submit payloads.

If PUT returns **403 SignatureDoesNotMatch**, check Content-Type mismatch before re-checking CORS.

---

## Automated backend tests

| Command | Result |
| --- | --- |
| `npm test` (includes `tests/vendor/vendor-onboarding-upload-mime.test.js`) | **228 pass**, 0 fail |

Unit tests prove MIME allowlist, auth wiring, and `ContentType` on `PutObjectCommand`; they do **not** replace live S3 CORS proof.

---

## Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| No `Access-Control-Allow-Origin` on S3 PUT | Bucket CORS missing/wrong origin | Re-apply policy above on correct bucket |
| CORS OK, PUT 403 | Content-Type ≠ signed type | Align `fileType` query with PUT header |
| `upload-url` 401/403 | Vendor auth / OTP | Express auth — not S3 |
| PUT OK, file not viewable | Bucket policy / object ACL | Separate from upload CORS |

---

## Out of scope

- Stripe / payment / webhook changes
- Express API CORS middleware changes
- Bucket public-read policy (unless upload succeeds but GET of `fileUrl` fails)

---

## Related docs

- [`docs/TEST_MATRIX.md`](TEST_MATRIX.md) — P2.6 upload smoke row
- [`docs/VENDOR_LIFECYCLE.md`](VENDOR_LIFECYCLE.md) — Stage 1 upload route
- [`docs/production-smoke-checklist.md`](production-smoke-checklist.md) — P2.6 upload URL check
