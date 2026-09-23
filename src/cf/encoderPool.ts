/** Named warm instances. Same jobId always hits the same slot (retries + DO cache). */
export const ENCODER_POOL_SIZE = 2;

export function encoderPoolName(jobId: string, poolSize: number = ENCODER_POOL_SIZE): string {
  const n = Math.max(1, Math.floor(poolSize));
  let hash = 2166136261;
  for (let i = 0; i < jobId.length; i += 1) {
    hash ^= jobId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `encoder-pool-${(hash >>> 0) % n}`;
}
