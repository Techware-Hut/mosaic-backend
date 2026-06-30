# Vendor PDF Upload CORS Runbook

This app uses AWS S3 presigned URLs for vendor onboarding document uploads. Supabase Storage is not part of the current vendor PDF upload path.

## Request Flow

1. Vendor opens `/partners/business-profile`.
2. Frontend calls the authenticated API route:
   `GET /api/vendor-onboarding/stage1/upload-url`.
3. Backend verifies the session and `business_owner` vendor permissions, validates the document type, MIME type, and size, then returns a presigned S3 `PUT` URL.
4. Frontend uploads the PDF directly to the presigned S3 URL with:
   - method: `PUT`
   - header: `Content-Type: application/pdf`
   - credentials: omitted
   - no `Authorization`, `x-upsert`, cache-control, or app custom headers
5. Frontend saves the returned `fileUrl` in the vendor onboarding draft.

The API CORS policy and the S3 bucket CORS policy are separate. A successful `upload-url` response proves API auth/CORS is working, but the browser still preflights the direct S3 `PUT`.

## Required Environment

Backend runtime:

| Variable | Purpose |
| --- | --- |
| `AWS_REGION` | S3 client region |
| `AWS_ACCESS_KEY_ID` | Server-side S3 signing/apply credentials |
| `AWS_SECRET_ACCESS_KEY` | Server-side S3 signing/apply credentials |
| `AWS_S3_BUCKET` | Upload bucket name |
| `S3_UPLOAD_CORS_ORIGINS` | Optional comma-separated browser origins for S3 upload CORS |

If `S3_UPLOAD_CORS_ORIGINS` is not set, the helper falls back to `CORS_ORIGINS`, `FRONTEND_URL`, the production app origins, and local dev origins.

## S3 Bucket CORS

The S3 bucket must allow browser preflight for the frontend origin and the signed `PUT` request. AWS S3 CORS rules do not list `OPTIONS` as an allowed method; S3 answers `OPTIONS` when the requested method, origin, and headers match a rule.

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
      "AllowedMethods": ["PUT", "GET", "HEAD"],
      "AllowedHeaders": ["Content-Type"],
      "ExposeHeaders": ["ETag"],
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
2. Open `/partners/business-profile`.
3. Upload a PDF for refund policy or terms/service agreement.
4. Confirm `GET /api/vendor-onboarding/stage1/upload-url` returns `200`.
5. Confirm the S3 `OPTIONS` preflight does not return `403`.
6. Confirm the S3 `PUT` returns a success status.
7. Confirm the resulting object key is under the authenticated vendor path:
   `vendor-onboarding/business-profile/{vendorUserId}/...`.
8. Confirm a customer or unauthenticated session cannot get a signed upload URL.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `upload-url` fails `401`/`403` | User session or vendor role check failed | Fix login/vendor verification, not S3 CORS |
| `upload-url` returns `200`, then S3 `OPTIONS` returns `403` | Bucket CORS missing origin, `PUT`, or `Content-Type` | Apply this S3 CORS rule |
| S3 `OPTIONS` passes, but `PUT` fails signature error | Frontend changed signed headers or upload method | Use direct `PUT` with the resolved content type only |
| Local dev upload fails | Localhost origin missing from bucket CORS | Add local origin and reapply |
