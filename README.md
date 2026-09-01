# myso-video-encoder

Production ffmpeg encoder for DripDrop short-form HLS (`dripdrop-social-v1`).

Deploy target: **Cloudflare Worker + Container** (see [docs/cloudflare-deploy.md](docs/cloudflare-deploy.md)).

Implements the dripdrop-backend contract:

- `POST /v1/jobs` + `Idempotency-Key`
- Signed GET source download (no source-bucket credentials)
- CMAF/fMP4 HLS under `{assetId}/`, **`master.m3u8` last**
- HMAC callback to `/v1/internal/encoder/callback`

## Local development

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

## Cloudflare deploy

See [docs/cloudflare-deploy.md](docs/cloudflare-deploy.md) and [docs/backend-wiring.md](docs/backend-wiring.md).

```bash
npm run secrets:cf   # once, from .env
npm run deploy       # requires Docker + Containers enabled on CF account
```

Local backend → local encoder:

```text
ENCODER_BASE_URL=http://127.0.0.1:8080
ENCODER_CALLBACK_PUBLIC_URL=http://<LAN-IP>:5050/v1/internal/encoder/callback
```

## Contract docs

- [docs/backend-integration.md](docs/backend-integration.md)
- [docs/cloudflare-deploy.md](docs/cloudflare-deploy.md)
- Sibling repo `dripdrop-backend/docs/video/encoder-job.md` and `dripdrop-social-v1.md`
