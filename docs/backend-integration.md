# Backend integration contract

The encoder expects **dripdrop-backend** to trigger jobs after iOS upload completes. This repo does not contain the backend; verify the following in `dripdrop-backend` before production deploy.

## Expected flow

```text
iOS POST /v1/videos/uploads
  → presigned multipart PUT URLs
iOS PUT parts → R2 (source bucket)
iOS POST /v1/videos/{assetId}/complete
  → backend finalizes multipart, computes commitments
  → backend presigns source GET URL
  → backend POST {ENCODER_BASE_URL}/v1/jobs  (async, non-blocking)
encoder downloads source → transcodes → uploads HLS to streams bucket
encoder POST {callbackUrl} with HMAC signature
```

## iOS endpoints (confirmed in ProjectYZ/ios)

| Method | Path | Role |
|--------|------|------|
| POST | `/v1/videos/uploads` | Create multipart session |
| PUT | presigned `uploadUrl` | Direct to R2 |
| POST | `/v1/videos/{assetId}/complete` | Finalize upload |
| DELETE | `/v1/videos/{assetId}` | Rollback on publish failure |

## Encoder job payload

See README and `src/types.ts`. Backend must send:

- `jobId`, `assetId`, `profile` (`dripdrop-social-v1`)
- `sourceUrl`, `sourceExpiresAt` (presigned GET — re-presign on every retry)
- `output.bucket`, `output.prefix` (`{assetId}/`)
- `callbackUrl` → `/v1/internal/encoder/callback`

Header: `Idempotency-Key: {jobId}`

## Backend env (after CF deploy)

```text
ENCODER_BASE_URL=https://<worker-url>
ENCODER_CALLBACK_PUBLIC_URL=https://<api-host>/v1/internal/encoder/callback
ENCODER_CALLBACK_HMAC_KEYS=enc1:<same-as-container-secret>
```

## Verification checklist

- [ ] `completeUpload` triggers encoder job without blocking the HTTP response
- [ ] Source presigned GET URL is valid when encoder downloads
- [ ] Callback HMAC keys match encoder `ENCODER_CALLBACK_HMAC_KEYS` secret
- [ ] `output.bucket` matches environment (`dripdrop-video-streams-dev` for dev)
