# Cloudflare deployment

Production target: **Cloudflare Worker + Container**. The existing [Dockerfile](../Dockerfile) runs unchanged inside the container; the Worker routes `POST /v1/jobs` to a per-job container instance.

## Job state / idempotency

| Layer | Responsibility |
|-------|----------------|
| Worker | Routes `jobId` → `getContainer(VIDEO_ENCODER, jobId)` |
| Durable Object (`VideoEncoder`) | Caches **succeeded** job handles in `ctx.storage` so a completed job is not re-encoded after container sleep |
| Container (Express) | In-flight queue, file-backed job store, ffmpeg pipeline |

One container instance per `jobId`. Ephemeral container disk holds temp encode files; DO storage survives container restarts for terminal success responses.

## Prerequisites

- Docker Desktop running
- Cloudflare **Workers Paid** plan ($5/mo) with **Containers** enabled on your account
- `npx wrangler login`

If deploy fails with `Unauthorized` on `/containers/me`, enable Containers in the Cloudflare dashboard (Workers & Pages → Containers) or contact Cloudflare support — the Worker script uploads but the container image push requires account provisioning.

## 1. Set secrets

Copy env and run:

```bash
cp .env.example .env
# fill R2 + HMAC values
npm run secrets:cf
```

Or manually:

```bash
npx wrangler secret put R2_ENDPOINT
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret put ENCODER_CALLBACK_HMAC_KEYS
npx wrangler secret put VIDEO_MEDIA_HOST
```

## 2. Deploy

```bash
npm install
npm run deploy
```

First deploy builds the Docker image locally and pushes to Cloudflare (several minutes).

## 3. Verify

```bash
curl https://<worker-url>/health
npx wrangler containers list
npx wrangler containers images list
npx wrangler tail
```

## 4. Wire dripdrop-backend

```text
ENCODER_BASE_URL=https://<worker-url>
ENCODER_CALLBACK_HMAC_KEYS=enc1:<same-as-container>
```

See [backend-integration.md](./backend-integration.md).

## 5. Smoke test

**Local Express** (no Cloudflare):

```bash
npm run smoke
```

**Deployed Worker** requires publicly reachable `sourceUrl` and `callbackUrl` (the container cannot call `127.0.0.1`). Use a tunnel or staging backend for end-to-end remote smoke.

## R2 binding

`wrangler.jsonc` binds `VIDEO_BUCKET` → `dripdrop-video-streams-dev`. Encoder uploads still use S3 SDK + secrets (V1). Native R2 bindings via container outbound handlers can be added later.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Deploy fails on Docker | Ensure Docker Desktop is running |
| Container 403 on R2 upload | Check R2 API token + secrets |
| Callback never arrives | Container needs outbound internet; HMAC keys must match backend |
| Source download fails | Presigned GET must be reachable from Cloudflare (not localhost) |
