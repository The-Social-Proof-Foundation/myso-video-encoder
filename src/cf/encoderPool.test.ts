import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { encoderPoolName, ENCODER_POOL_SIZE } from './encoderPool';

describe('encoderPoolName', () => {
  it('is stable for the same jobId', () => {
    assert.equal(encoderPoolName('job-abc'), encoderPoolName('job-abc'));
  });

  it('stays inside the pool', () => {
    const names = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      names.add(encoderPoolName(`job-${i}`));
    }
    assert.equal(names.size <= ENCODER_POOL_SIZE, true);
    for (const name of names) {
      assert.match(name, /^encoder-pool-[01]$/);
    }
  });

  it('can spread different jobs across slots', () => {
    const a = encoderPoolName('job-alpha');
    const b = encoderPoolName('job-beta');
    const c = encoderPoolName('job-gamma');
    assert.equal([a, b, c].every((n) => n.startsWith('encoder-pool-')), true);
  });
});
