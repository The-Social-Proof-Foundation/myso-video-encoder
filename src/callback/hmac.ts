import crypto from 'crypto';
import { HmacKeyRing } from '../config';

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function signHmacBody(secret: string, timestamp: string, rawBody: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export function pickCallbackKey(ring: HmacKeyRing): { keyId: string; secret: string } {
  const first = ring.entries().next();
  if (first.done) {
    throw new Error('ENCODER_CALLBACK_HMAC_KEYS not configured');
  }
  return { keyId: first.value[0], secret: first.value[1] };
}

export function buildSignedHeaders(
  ring: HmacKeyRing,
  rawBody: string,
  nowMs = Date.now(),
): { 'X-Timestamp': string; 'X-Signature': string; 'X-Key-Id': string } {
  const { keyId, secret } = pickCallbackKey(ring);
  const timestamp = String(Math.floor(nowMs / 1000));
  return {
    'X-Timestamp': timestamp,
    'X-Signature': signHmacBody(secret, timestamp, rawBody),
    'X-Key-Id': keyId,
  };
}
