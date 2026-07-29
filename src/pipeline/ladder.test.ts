import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLadder, fitInBox, orientationOf } from './ladder';

test('tiny source yields source rung only', () => {
  const ladder = buildLadder(240, 426);
  assert.equal(ladder.length, 1);
  assert.equal(ladder[0].name, 'source');
  assert.ok(ladder[0].width <= 240);
  assert.ok(ladder[0].height <= 426);
});

test('portrait 9:16 ladder does not upscale or pad', () => {
  const ladder = buildLadder(1080, 1920);
  assert.ok(ladder.length >= 2);
  assert.ok(ladder.some((r) => r.name === '1080'));
  assert.ok(ladder.some((r) => r.name === '360'));
  for (const r of ladder) {
    assert.ok(r.width <= 1080);
    assert.ok(r.height <= 1920);
    assert.equal(r.width % 2, 0);
    assert.equal(r.height % 2, 0);
  }
});

test('fitInBox rejects upscale', () => {
  assert.equal(fitInBox(100, 100, 200, 200), null);
  const fitted = fitInBox(1920, 1080, 1280, 720);
  assert.ok(fitted);
  assert.ok(fitted!.width <= 1280);
  assert.ok(fitted!.height <= 720);
});

test('orientation detection', () => {
  assert.equal(orientationOf(1080, 1920), 'portrait');
  assert.equal(orientationOf(1920, 1080), 'landscape');
  assert.equal(orientationOf(800, 800), 'square');
});
