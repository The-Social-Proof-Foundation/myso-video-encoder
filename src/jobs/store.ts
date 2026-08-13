import fs from 'fs';
import path from 'path';
import { getConfig } from '../config';
import { EncoderJobRequest, JobStatus, StoredJob } from '../types';
import { sha256Hex } from '../callback/hmac';

export function stablePayloadHash(req: EncoderJobRequest): string {
  // Exclude sourceUrl / sourceExpiresAt — backend re-presigns on every submit/retry.
  const canonical = JSON.stringify({
    jobId: req.jobId,
    assetId: req.assetId,
    profile: req.profile,
    output: req.output,
    callbackUrl: req.callbackUrl,
    watermark: req.watermark ?? null,
  });
  return sha256Hex(canonical);
}

export class JobStore {
  private readonly mem = new Map<string, StoredJob>();
  private readonly filePath: string;

  constructor(filePath?: string) {
    const tmp = getConfig().tmpDir;
    this.filePath = filePath || path.join(tmp, 'job-store.json');
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as StoredJob[];
      for (const job of raw) {
        this.mem.set(job.jobId, job);
      }
    } catch (err) {
      console.warn('[encoder] job store load failed', err);
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify([...this.mem.values()], null, 2));
    } catch (err) {
      console.warn('[encoder] job store persist failed', err);
    }
  }

  getByIdempotencyKey(key: string): StoredJob | undefined {
    return this.mem.get(key);
  }

  list(): StoredJob[] {
    return [...this.mem.values()];
  }

  /** After a process restart, in-flight jobs are orphans — mark failed so backend can retry. */
  markOrphansFailed(): StoredJob[] {
    const orphans: StoredJob[] = [];
    for (const job of this.mem.values()) {
      if (job.status === 'accepted' || job.status === 'running') {
        job.status = 'failed';
        job.errorCode = 'ORPHANED_RESTART';
        job.updatedAt = new Date().toISOString();
        orphans.push(job);
      }
    }
    if (orphans.length) this.persist();
    return orphans;
  }

  create(encoderJobId: string, request: EncoderJobRequest): StoredJob {
    const now = new Date().toISOString();
    const job: StoredJob = {
      encoderJobId,
      jobId: request.jobId,
      status: 'accepted',
      payloadHash: stablePayloadHash(request),
      request,
      createdAt: now,
      updatedAt: now,
    };
    this.mem.set(request.jobId, job);
    this.persist();
    return job;
  }

  updateStatus(jobId: string, status: JobStatus, errorCode?: string): void {
    const job = this.mem.get(jobId);
    if (!job) return;
    job.status = status;
    job.updatedAt = new Date().toISOString();
    if (errorCode) job.errorCode = errorCode;
    this.persist();
  }

  /** Re-bind request (fresh signed source URL) and mark accepted for a retry. */
  prepareRetry(jobId: string, request: EncoderJobRequest): StoredJob | undefined {
    const job = this.mem.get(jobId);
    if (!job) return undefined;
    job.request = request;
    job.payloadHash = stablePayloadHash(request);
    job.status = 'accepted';
    job.errorCode = undefined;
    job.updatedAt = new Date().toISOString();
    this.persist();
    return job;
  }
}
