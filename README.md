# myso-video-encoder

Production ffmpeg encoder for DripDrop short-form HLS (`dripdrop-social-v1`).

Implements the dripdrop-backend contract:

- `POST /v1/jobs` + `Idempotency-Key`
- Signed GET source download (no source-bucket credentials)
- CMAF/fMP4 HLS under `{assetId}/`, **`master.m3u8` last**
- HMAC callback to `/v1/internal/encoder/callback`

## Local

```bash
cp .env.example .env
# fill R2 streams-bucket write creds + ENCODER_CALLBACK_HMAC_KEYS (same ring as backend)

npm install
npm run dev
# GET http://127.0.0.1:8080/health
```

Requires system `ffmpeg` / `ffprobe` on PATH for encode jobs.

```bash
npm test
```

## Smoke test

```bash
npm run build
set -a && source .env && set +a
VIDEO_STREAMS_BUCKET=dripdrop-video-streams-dev node scripts/smoke-encode.mjs
```

## Railway

- Project: `myso-video-encoder` (Docker via `railway.toml`)
- Production URL: `https://myso-video-encoder-production.up.railway.app`
- Health: `GET /health` → `{"ok":true,"service":"myso-video-encoder"}`
- Env vars match `.env.example` (streams-bucket write + callback HMAC)

Point dripdrop-backend:

```text
ENCODER_BASE_URL=https://myso-video-encoder-production.up.railway.app
ENCODER_CALLBACK_PUBLIC_URL=https://<public-api-host>/v1/internal/encoder/callback
ENCODER_CALLBACK_HMAC_KEYS=enc1:<same-secret>
```

Local backend → local encoder (Railway cannot reach a LAN callback without a tunnel):

```text
ENCODER_BASE_URL=http://127.0.0.1:8080
ENCODER_CALLBACK_PUBLIC_URL=http://<LAN-IP>:5050/v1/internal/encoder/callback
```

## Contract docs

See sibling repo `dripdrop-backend/docs/video/encoder-job.md` and `dripdrop-social-v1.md`.
