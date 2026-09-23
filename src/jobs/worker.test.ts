import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JobStore } from './store';
import { JobWorker } from './worker';
import { EncoderJobRequest } from '../types';

const IDLE_MS = 40;

function sample(jobId: string): EncoderJobRequest {
  return {
    jobId,
    assetId: 'vid_abc',
    profile: 'dripdrop-social-v1',
    sourceUrl: 'https://example.com/src',
    sourceExpiresAt: '2030-01-01T00:00:00.000Z',
    output: { bucket: 'streams', prefix: 'vid_abc/' },
    callbackUrl: 'https://api.example/callback',
  };
}

function tempStore(): { store: JobStore; cleanup: () => void } {
  const file = path.join(os.tmpdir(), `job-worker-${process.pid}-${Math.random()}.json`);
  return {
    store: new JobStore(file),
    cleanup: () => {
      try {
        fs.unlinkSync(file);
      } catch {
        /* ignore */
      }
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('fires onIdle after startup when no job ever arrives', async () => {
  const { store, cleanup } = tempStore();
  try {
    let idleCalls = 0;
    new JobWorker(store, { idleTimeoutMs: IDLE_MS, onIdle: () => (idleCalls += 1), run: async () => {} });
    await sleep(IDLE_MS * 3);
    assert.equal(idleCalls, 1);
  } finally {
    cleanup();
  }
});

test('does not fire onIdle while a job runs, then fires after it drains', async () => {
  const { store, cleanup } = tempStore();
  try {
    let idleCalls = 0;
    let finish!: () => void;
    const worker = new JobWorker(store, {
      idleTimeoutMs: IDLE_MS,
      onIdle: () => (idleCalls += 1),
      run: () => new Promise<void>((resolve) => (finish = resolve)),
    });
    store.create('enc-1', sample('job-1'));
    worker.enqueue('enc-1', sample('job-1'));

    await sleep(IDLE_MS * 3);
    assert.equal(idleCalls, 0);
    assert.equal(worker.isIdle(), false);

    finish();
    await sleep(IDLE_MS * 3);
    assert.equal(idleCalls, 1);
    assert.equal(store.getByIdempotencyKey('job-1')?.status, 'succeeded');
  } finally {
    cleanup();
  }
});

test('never fires onIdle when disabled', async () => {
  const { store, cleanup } = tempStore();
  try {
    let idleCalls = 0;
    new JobWorker(store, { idleTimeoutMs: 0, onIdle: () => (idleCalls += 1), run: async () => {} });
    await sleep(IDLE_MS * 3);
    assert.equal(idleCalls, 0);
  } finally {
    cleanup();
  }
});
