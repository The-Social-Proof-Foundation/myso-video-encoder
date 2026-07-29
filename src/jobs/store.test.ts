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

test('JobStore create and lookup', () => {
  const file = path.join(os.tmpdir(), `job-store-${Date.now()}.json`);
  try {
    const store = new JobStore(file);
    const req = sample();
    const job = store.create('enc-1', req);
    assert.equal(job.encoderJobId, 'enc-1');
    const found = store.getByIdempotencyKey('job-1');
    assert.ok(found);
    assert.equal(found!.payloadHash, stablePayloadHash(req));
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
});
