# Cloudflare deployment

Production target: **Cloudflare Worker + Container**. The existing [Dockerfile](../Dockerfile) runs unchanged inside the container; the Worker hashes `jobId` onto a **warm pool** (`encoder-pool-0` / `encoder-pool-1`) instead of one container per job.

Instances are `standard-2` (1 vCPU / 6 GiB / 12 GB), `max_instances: 2` to match the two pool names. Jobs hash onto `encoder-pool-0` / `encoder-pool-1`, so two encodes can run at once; both should drop to **0** live instances about a minute after the queue drains.

## Container lifetime and cost

Memory and disk are billed for the provisioned size the whole time an instance is up. An instance must stop when it has no work. Three limits, independent of each other:

| Limit | Where | Behaviour |
|-------|-------|-----------|
| Idle exit | [Dockerfile](../Dockerfile) `ENCODER_EXIT_WHEN_IDLE_SEC=60`, [src/jobs/worker.ts](../src/jobs/worker.ts) | Process exits 60s after the queue is empty, including right after boot if no job arrives. Set `0` in local `.env` to disable. |
| Hard stop | `VideoEncoder` in [worker/index.ts](../worker/index.ts) | Armed when the Durable Object sees a running container (constructor), when the container starts (`onStart`), and on each job `fetch`. After 15 min it `destroy()`s (SIGKILL). `sleepAfter` is also 15m and calls the same `destroy()`, not SIGTERM. It is 15m rather than 2m because the HTTP handler returns 202 before ffmpeg finishes. |
| Instance cap | `max_instances: 2` in [wrangler.jsonc](../wrangler.jsonc) | At most two `standard-2` boxes. Scale is horizontal (pool slots), not a permanently warm `standard-4`. |

`npx wrangler containers list` should show **LIVE INSTANCES: 0** within about 2 minutes of the last job. Two live instances with no traffic means a shutdown path failed; redeploy to replace them.

The hard stop is 15 minutes after the **latest** request to that pool slot. Source length is capped at 180s, so a normal queue drains well inside it. A burst that takes longer than 15 minutes on one slot is killed and needs a backend retry.

Expected cost is encode time plus about a minute on `standard-2`, not two boxes left up all month.

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
| Log shows `destroying container` | Hard stop or `sleepAfter` (both 15 min) killed the VM. Check for a hung ffmpeg or a slot that never went idle |
| Instance still running long after the last job | `npx wrangler containers list`; a redeploy (rollout) replaces it |
