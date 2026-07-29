import { getConfig } from '../config';
import { EncoderJobRequest } from '../types';
import { JobStore } from './store';
import { runEncodeJob } from '../pipeline/runJob';

type QueueItem = {
  encoderJobId: string;
  request: EncoderJobRequest;
};

export class JobWorker {
  private readonly queue: QueueItem[] = [];
  private active = 0;
  private readonly store: JobStore;

  constructor(store: JobStore) {
    this.store = store;
  }

  enqueue(encoderJobId: string, request: EncoderJobRequest): void {
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
      });
    }
  }

  private async runOne(item: QueueItem): Promise<void> {
    this.store.updateStatus(item.request.jobId, 'running');
    try {
      await runEncodeJob(item.encoderJobId, item.request);
      this.store.updateStatus(item.request.jobId, 'succeeded');
    } catch (err) {
      const code = err && typeof err === 'object' && 'errorCode' in err ? String((err as { errorCode: string }).errorCode) : 'ENCODE_FAILED';
      this.store.updateStatus(item.request.jobId, 'failed', code);
      console.error('[encoder] job failed', item.request.jobId, err);
    }
  }
}
