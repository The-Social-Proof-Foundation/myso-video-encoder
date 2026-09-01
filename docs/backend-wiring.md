# Backend wiring after deploy

Once `npm run deploy` succeeds, note the Worker URL from wrangler output:

```text
https://dripdrop-video-encoder.<your-subdomain>.workers.dev
```

## dripdrop-backend env

```text
ENCODER_BASE_URL=https://dripdrop-video-encoder.<your-subdomain>.workers.dev
ENCODER_CALLBACK_PUBLIC_URL=https://<public-api-host>/v1/internal/encoder/callback
ENCODER_CALLBACK_HMAC_KEYS=enc1:<same-value-as-wrangler-secret>
```

Restart the backend after updating env vars.

## Verify

```bash
curl https://dripdrop-video-encoder.<your-subdomain>.workers.dev/health
# {"ok":true,"service":"myso-video-encoder"}
```

Publish a video from iOS and confirm:

1. Backend receives HMAC callback at `/v1/internal/encoder/callback`
2. R2 streams bucket contains `{assetId}/master.m3u8`
3. HLS playback works in the app

No iOS changes required.
