import { getConfig } from '../config';
import { EncoderJobRequest } from '../types';
import { JobStore } from './store';
import { runEncodeJob } from '../pipeline/runJob';
import { runExportJob } from '../pipeline/runExportJob';
import { EXPORT_PROFILE } from '../types';

type QueueItem = {
  encoderJobId: string;
  request: EncoderJobRequest;
};

export type JobRunner = (encoderJobId: string, request: EncoderJobRequest) => Promise<void>;

export interface JobWorkerOptions {
  run?: JobRunner;
  /** Fired once after `idleTimeoutMs` with nothing running or queued. */
  onIdle?: () => void;
  idleTimeoutMs?: number;
}

const runByProfile: JobRunner = (encoderJobId, request) =>
  request.profile === EXPORT_PROFILE
    ? runExportJob(encoderJobId, request)
    : runEncodeJob(encoderJobId, request);

export class JobWorker {
  private readonly queue: QueueItem[] = [];
  private active = 0;
  private readonly store: JobStore;
  private readonly run: JobRunner;
  private readonly onIdle?: () => void;
  private readonly idleTimeoutMs: number;
  private idleTimer: NodeJS.Timeout | undefined;

  constructor(store: JobStore, options: JobWorkerOptions = {}) {
    this.store = store;
    this.run = options.run ?? runByProfile;
    this.onIdle = options.onIdle;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 0;
    // Armed at construction: a container can start without ever receiving a job.
    this.armIdleTimer();
  }

  isIdle(): boolean {
    return this.active === 0 && this.queue.length === 0;
  }

  enqueue(encoderJobId: string, request: EncoderJobRequest): void {
    this.clearIdleTimer();
    this.queue.push({ encoderJobId, request });
    this.pump();
  }

  private pump(): void {
    const max = getConfig().maxConcurrent;
    while (this.active < max && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.active += 1;
      void this.runOne(item).finally(() => {
        this.active -= 1;
        this.pump();
        this.armIdleTimer();
      });
    }
  }

  private armIdleTimer(): void {
    if (!this.onIdle || this.idleTimeoutMs <= 0 || !this.isIdle()) return;
    this.clearIdleTimer();
    const onIdle = this.onIdle;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (this.isIdle()) onIdle();
    }, this.idleTimeoutMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  private async runOne(item: QueueItem): Promise<void> {
    this.store.updateStatus(item.request.jobId, 'running');
    try {
      await this.run(item.encoderJobId, item.request);
      this.store.updateStatus(item.request.jobId, 'succeeded');
    } catch (err) {
      const code = err && typeof err === 'object' && 'errorCode' in err ? String((err as { errorCode: string }).errorCode) : 'ENCODE_FAILED';
      this.store.updateStatus(item.request.jobId, 'failed', code);
      console.error('[encoder] job failed', item.request.jobId, err);
    }
  }
}
