import crypto from 'crypto';
import express from 'express';
import { getConfig } from './config';
import { JobStore, stablePayloadHash } from './jobs/store';
import { JobWorker } from './jobs/worker';
import { EncoderJobRequest, PROFILE } from './types';

const app = express();
app.use(express.json({ limit: '1mb' }));

const store = new JobStore();
const worker = new JobWorker(store);
const orphans = store.markOrphansFailed();
if (orphans.length) {
  console.warn(`[encoder] marked ${orphans.length} orphaned in-flight job(s) failed for retry`);
}

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'myso-video-encoder' });
});

app.post('/v1/jobs', (req, res) => {
  const idempotencyKey = String(req.header('Idempotency-Key') || '').trim();
  if (!idempotencyKey) {
    res.status(400).json({ error: 'Idempotency-Key required' });
    return;
  }

  const body = req.body as Partial<EncoderJobRequest>;
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  const request: EncoderJobRequest = {
    jobId: String(body.jobId || ''),
    assetId: String(body.assetId || ''),
    profile: String(body.profile || ''),
    sourceUrl: String(body.sourceUrl || ''),
    sourceExpiresAt: String(body.sourceExpiresAt || ''),
    output: {
      bucket: String(body.output?.bucket || ''),
      prefix: String(body.output?.prefix || ''),
    },
    callbackUrl: String(body.callbackUrl || ''),
  };

  if (request.jobId !== idempotencyKey) {
    res.status(400).json({ error: 'Idempotency-Key must equal jobId' });
    return;
  }
  if (request.profile !== PROFILE) {
    res.status(400).json({ error: `Unsupported profile (expected ${PROFILE})` });
    return;
  }
  if (request.output.prefix !== `${request.assetId}/`) {
    res.status(400).json({ error: 'output.prefix must be {assetId}/' });
    return;
  }
  if (!request.assetId || !request.sourceUrl || !request.callbackUrl || !request.output.bucket) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  const existing = store.getByIdempotencyKey(idempotencyKey);
  const hash = stablePayloadHash(request);
  if (existing) {
    if (existing.payloadHash !== hash) {
      res.status(409).json({ error: 'Idempotency conflict' });
      return;
    }
    // Failed jobs (including orphans marked failed on process restart) retry with fresh source URL.
    if (existing.status === 'failed') {
      const retried = store.prepareRetry(idempotencyKey, request);
      worker.enqueue(existing.encoderJobId, request);
      res.status(202).json({
        encoderJobId: existing.encoderJobId,
        jobId: existing.jobId,
        status: retried?.status || 'accepted',
      });
      return;
    }
    // accepted/running/succeeded — return existing handle (single-flight)
    res.status(200).json({
      encoderJobId: existing.encoderJobId,
      jobId: existing.jobId,
      status: existing.status,
    });
    return;
  }

  const encoderJobId = crypto.randomUUID();
  const job = store.create(encoderJobId, request);
  // Capture accept status before the worker mutates the store.
  const acceptedStatus = job.status;
  worker.enqueue(encoderJobId, request);

  res.status(202).json({
    encoderJobId: job.encoderJobId,
    jobId: job.jobId,
    status: acceptedStatus,
  });
});

const cfg = getConfig();
app.listen(cfg.port, () => {
  console.log(`[encoder] listening on :${cfg.port} (maxConcurrent=${cfg.maxConcurrent})`);
});
