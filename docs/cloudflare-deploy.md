# Cloudflare deployment

Production target: **Cloudflare Worker + Container**. The existing [Dockerfile](../Dockerfile) runs unchanged inside the container; the Worker hashes `jobId` onto a **warm pool** (`encoder-pool-0` / `encoder-pool-1`) instead of one container per job.

Instances are `standard-4` (4 vCPU / 12 GiB / 20 GB), `max_instances: 2` to match the two pool names.

## Container lifetime and cost

Memory and disk are billed for the provisioned size the whole time an instance is up, and each instance's Durable Object bills duration for the same window. An instance must stop when it has no work. Three limits, independent of each other:

| Limit | Where | Behaviour |
|-------|-------|-----------|
| Idle exit | [src/jobs/worker.ts](../src/jobs/worker.ts), `ENCODER_EXIT_WHEN_IDLE_SEC=60` | Process exits 60s after the queue is empty. Armed at process start, so a container that never receives a job still exits. `0` (default) disables it for local dev. |
| Hard stop | `VideoEncoder.hardStop` in [worker/index.ts](../worker/index.ts) | Every job request stores a deadline 15 min out in Durable Object storage before it awaits the container. When it fires, the Durable Object `destroy()`s (SIGKILL) the container. `onStop` clears it. |
| Instance cap | `max_instances: 2` in [wrangler.jsonc](../wrangler.jsonc) | Worst case is two instances, not four. |

`sleepAfter` (30m) is only a last resort. The SDK's idle stop sends SIGTERM, and node as PID 1 ignores SIGTERM without a handler, which is how the Aug 2026 cycle left two instances up for the whole month. [src/index.ts](../src/index.ts) now handles SIGTERM, exiting once in-flight jobs finish.

The hard stop is 15 minutes after the **latest** request to that pool slot. Source length is capped at 180s, so a normal queue drains well inside it. A burst of many jobs to one slot that takes longer than 15 minutes to drain is killed, and the unfinished jobs need a backend retry.

Rough monthly ceiling if every limit failed: two idle `standard-4` instances, about $175 plus one $12.50 Durable Object duration unit. Expected cost per job is the encode time plus about a minute.

## Job state / idempotency

| Layer | Responsibility |
|-------|----------------|
| Worker | Routes `jobId` → `getContainer(VIDEO_ENCODER, encoder-pool-{hash})` |
| Durable Object (`VideoEncoder`) | Caches **succeeded** job handles in `ctx.storage` so a completed job is not re-encoded after container sleep |
| Container (Express) | In-flight queue, file-backed job store, ffmpeg pipeline |

Same `jobId` always hits the same pool slot (retries + cache). Ephemeral container disk holds temp encode files; DO storage survives container restarts for terminal success responses.

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
| First job after idle is slow | Expected: the container exits 60s after its queue drains, so the next job cold-starts |
| Encode dies ~2 min after accept | Old `sleepAfter` was 2m (HTTP-idle). Current is 30m — redeploy if you still see this |
| Log shows `hard stop deadline reached` | A slot ran 15 min past its last request. Check for a hung ffmpeg or a large burst to one slot |
| Instance still running long after the last job | `npx wrangler containers list`; a redeploy (rollout) replaces it |
