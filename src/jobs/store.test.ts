import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JobStore, stablePayloadHash } from './store';
import { EncoderJobRequest } from '../types';

function sample(overrides: Partial<EncoderJobRequest> = {}): EncoderJobRequest {
  return {
    jobId: 'job-1',
    assetId: 'vid_abc',
    profile: 'dripdrop-social-v1',
    sourceUrl: 'https://example.com/src',
    sourceExpiresAt: '2030-01-01T00:00:00.000Z',
    output: { bucket: 'streams', prefix: 'vid_abc/' },
    callbackUrl: 'https://api.example/callback',
    ...overrides,
  };
}

test('idempotency ignores volatile sourceUrl; stable field changes differ', () => {
  const a = sample();
  const b = sample({ sourceUrl: 'https://example.com/other', sourceExpiresAt: '2031-01-01T00:00:00.000Z' });
  const c = sample({ assetId: 'vid_other', output: { bucket: 'streams', prefix: 'vid_other/' } });
  assert.equal(stablePayloadHash(a), stablePayloadHash(b));
  assert.notEqual(stablePayloadHash(a), stablePayloadHash(c));
});

test('prepareRetry updates payload hash when output prefix changes', () => {
  const file = path.join(os.tmpdir(), `job-store-retry-${Date.now()}.json`);
  try {
    const store = new JobStore(file);
    const req = sample({ output: { bucket: 'streams', prefix: 'vid_abc/export/' } });
    store.create('enc-1', req);
    store.updateStatus('job-1', 'failed', 'ENCODE_FAILED');

    const updated = sample({ output: { bucket: 'streams', prefix: 'vid_abc/' } });
    const retried = store.prepareRetry('job-1', updated);
    assert.ok(retried);
    assert.equal(retried!.payloadHash, stablePayloadHash(updated));
    assert.notEqual(retried!.payloadHash, stablePayloadHash(req));
    assert.equal(retried!.status, 'accepted');
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
});

test('prepareRetry updates payload hash after succeeded (re-export)', () => {
  const file = path.join(os.tmpdir(), `job-store-reexport-${Date.now()}.json`);
  try {
    const store = new JobStore(file);
    const req = sample();
    store.create('enc-1', req);
    store.updateStatus('job-1', 'succeeded');

    const updated = sample({ output: { bucket: 'streams', prefix: 'vid_abc/v2/' } });
    const retried = store.prepareRetry('job-1', updated);
    assert.ok(retried);
    assert.equal(retried!.payloadHash, stablePayloadHash(updated));
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
});
