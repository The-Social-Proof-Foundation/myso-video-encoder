import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSignedHeaders, sha256Hex, signHmacBody } from './hmac';

test('signHmacBody matches timestamp.body contract', () => {
  const secret = 'test-secret';
  const timestamp = '1710000000';
  const body = '{"ok":true}';
  const sig = signHmacBody(secret, timestamp, body);
  assert.equal(sig, signHmacBody(secret, timestamp, body));
  assert.notEqual(sig, signHmacBody(secret, timestamp, '{"ok":false}'));
});

test('buildSignedHeaders uses first key in ring', () => {
  const ring = new Map([
    ['enc1', 'secret-one'],
    ['enc2', 'secret-two'],
  ]);
  const body = '{"status":"succeeded"}';
  const headers = buildSignedHeaders(ring, body, 1_710_000_000_000);
  assert.equal(headers['X-Key-Id'], 'enc1');
  assert.equal(headers['X-Timestamp'], '1710000000');
  assert.equal(headers['X-Signature'], signHmacBody('secret-one', '1710000000', body));
});

test('sha256Hex stable', () => {
  assert.equal(sha256Hex('abc'), sha256Hex('abc'));
  assert.notEqual(sha256Hex('abc'), sha256Hex('abd'));
});
