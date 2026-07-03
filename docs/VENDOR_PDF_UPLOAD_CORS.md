# Vendor PDF Upload CORS Runbook

This app stores vendor onboarding documents in AWS S3. Supabase Storage is not part of the current vendor PDF upload path.

The intended vendor/business document UI paths now use one authenticated backend upload proxy so the browser uploads to the Mosaic API, not directly to S3. This applies to both `/partners/business/new` and `/partners/business-profile`. The presigned S3 route remains available for direct-upload diagnostics, but these two UI routes should not use it.

## Request Flow

1. Vendor opens `/partners/business/new` or `/partners/business-profile`.
2. Frontend posts `multipart/form-data` to:
   `POST /api/vendor-onboarding/stage1/upload-file`.
3. Backend verifies the session and `business_owner` vendor permissions, validates the document type, MIME type, and size, then writes the file to S3 under the authenticated vendor user path.
4. Frontend saves the returned `fileUrl` in the vendor onboarding draft or business profile payload.

The API proxy path uses normal backend CORS (`CORS_ORIGINS`) and does not require browser-to-S3 preflight. A successful proxy upload proves API auth/CORS and server-side S3 write behavior are working.

Legacy/direct S3 flow:

1. Frontend calls `GET /api/vendor-onboarding/stage1/upload-url`.
2. Backend returns a presigned S3 `PUT` URL plus `method`, `requiredHeaders`, storage `key`, and expiry metadata.
3. Browser uploads directly to S3 with `credentials: "omit"`, only the signed `Content-Type`, and the raw file body.

For this direct path, the API CORS policy and S3 bucket CORS policy are separate. A successful `upload-url` response proves API auth/CORS is working, but the browser still preflights the direct S3 `PUT`.

## Required Environment

Frontend runtime:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | Backend API origin used by `uploadVendorOnboardingFile` for `POST /api/vendor-onboarding/stage1/upload-file` |

Backend runtime:

| Variable | Purpose |
| --- | --- |
| `AWS_REGION` | S3 client region |
| `AWS_ACCESS_KEY_ID` | Server-side S3 signing/apply credentials |
| `AWS_SECRET_ACCESS_KEY` | Server-side S3 signing/apply credentials |
| `AWS_S3_BUCKET` | Upload bucket name |
| `S3_UPLOAD_CORS_ORIGINS` | Optional comma-separated browser origins for the direct S3 diagnostic upload path |

If `S3_UPLOAD_CORS_ORIGINS` is not set, the helper falls back to `CORS_ORIGINS`, `FRONTEND_URL`, the production app origins, and local dev origins. The canonical `/partners/business/new` and `/partners/business-profile` UI upload path does not need this variable because the browser posts to the backend API proxy.

## S3 Bucket CORS

The API proxy path does not require S3 bucket CORS. If using the legacy/direct presigned path, the S3 bucket must allow browser preflight for the frontend origin and the signed `PUT` request. AWS S3 CORS rules do not list `OPTIONS` as an allowed method; S3 answers `OPTIONS` when the requested method, origin, and headers match a rule.

Required rule shape:

```json
{
  "CORSRules": [
    {
      "ID": "MosaicVendorPresignedUploads",
      "AllowedOrigins": [
        "https://mosaicbizhub.com",
        "https://www.mosaicbizhub.com",
        "https://app.mosaicbizhub.com",
        "https://mosaic-biz-frontend-launch.vercel.app",
        "http://localhost:3000",
        "http://127.0.0.1:3000"
      ],
      "AllowedMethods": ["GET", "HEAD", "PUT", "POST"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag", "x-amz-request-id", "x-amz-id-2"],
      "MaxAgeSeconds": 3000
    }
  ]
}
```

For Vercel preview deployments, either add the exact preview origin to `S3_UPLOAD_CORS_ORIGINS` before applying the rule, or explicitly approve a wildcard preview origin such as `https://*.vercel.app`.

## Apply The Rule

Dry run:

```bash
npm run s3:cors:vendor-upload
```

Apply:

```bash
npm run s3:cors:vendor-upload -- --apply
```

The apply command writes only S3 bucket CORS. It preserves existing CORS rules and replaces only the `MosaicVendorPresignedUploads` managed rule. It does not change bucket policy, object ACLs, IAM permissions, or make files globally writable.

## Browser Test Checklist

Use a safe dummy PDF, not a real vendor document.

1. Log in as a verified vendor/business owner.
2. Open `/partners/business/new`.
3. Upload a safe dummy PDF or allowed image for minority proof, tax document, or business license.
4. Confirm `POST /api/vendor-onboarding/stage1/upload-file` returns `200`.
5. Confirm the upload request does not show a browser CORS failure.
6. Confirm no browser request is made directly to S3 for the vendor/business document path.
7. Confirm the resulting object key is under the authenticated vendor path:
   `vendor-onboarding/business-profile/{vendorUserId}/...`.
8. Save/continue, refresh the page, and confirm the uploaded metadata remains visible in the draft.
9. Open `/partners/business-profile`.
10. Upload or replace a safe dummy PDF for refund policy or terms/service agreement.
11. Confirm `POST /api/vendor-onboarding/stage1/upload-file` returns `200` and no direct S3 browser request is made.
12. Confirm a customer or unauthenticated session cannot use `POST /stage1/upload-file`.

## Direct S3 Preflight Regression Check

Run this only for the legacy/direct presigned path. Do not paste signed URLs, cookies, or vendor document contents into GitHub.

1. Log in as a verified vendor/business owner.
2. Request a direct presigned URL for a safe dummy PDF:
   `GET /api/vendor-onboarding/stage1/upload-url?fileName=dummy.pdf&fileType=application/pdf&fileSize=1024&documentType=refund-policy`.
3. Confirm the API response is `200` and includes `uploadUrl`, `method: "PUT"`, and `requiredHeaders["Content-Type"]`.
4. In the browser Network tab, or with a local-only curl using the redacted signed URL, confirm the S3 `OPTIONS` preflight for the active frontend origin returns an allow-origin header and allows `PUT` with `Content-Type`.
5. Confirm the following failure is not present: `upload-url` returns `200`, then the S3 `OPTIONS` request returns `403`.
6. If `OPTIONS` is `403`, do not change frontend auth headers. Re-apply the S3 bucket CORS rule for the exact frontend origin in use.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `POST /stage1/upload-file` fails `401`/`403` | User session or vendor role check failed | Fix login/vendor verification |
| `POST /stage1/upload-file` fails API CORS | Backend `CORS_ORIGINS` missing frontend origin | Add the frontend origin to backend CORS env |
| `/partners/business-profile` uploads work but `/partners/business/new` fails | Frontend route is using stale direct presign/S3 flow instead of `uploadVendorOnboardingFile` | Point both routes at the shared API-proxy helper |
| `upload-url` fails `401`/`403` | User session or vendor role check failed | Fix login/vendor verification, not S3 CORS |
| `upload-url` returns `200`, then S3 `OPTIONS` returns `403` | Bucket CORS missing origin, `PUT`, or `Content-Type` | Apply this S3 CORS rule |
| S3 `OPTIONS` passes, but `PUT` fails signature error | Frontend changed signed headers or upload method | Use direct `PUT` with `requiredHeaders["Content-Type"]` only |
| Local dev upload fails | Localhost origin missing from bucket CORS | Add local origin and reapply |
