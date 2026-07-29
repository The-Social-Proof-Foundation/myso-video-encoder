import { getConfig } from '../config';
import { EncoderFailureCallback, EncoderSuccessCallback } from '../types';
import { buildSignedHeaders } from './hmac';

const MAX_ATTEMPTS = 5;

export async function sendCallback(
  callbackUrl: string,
  payload: EncoderSuccessCallback | EncoderFailureCallback,
): Promise<void> {
  const cfg = getConfig();
  const rawBody = JSON.stringify(payload);
  const headers = buildSignedHeaders(cfg.callbackKeys, rawBody);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(callbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: rawBody,
      });
      if (res.ok) return;
      const text = await res.text().catch(() => '');
      lastErr = new Error(`Callback HTTP ${res.status}: ${text}`);
      // 4xx (except 429) — don't spin forever on bad payload
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw lastErr;
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, Math.min(30_000, 500 * 2 ** (attempt - 1))));
  }
  console.error('[encoder] callback failed after retries', lastErr);
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
