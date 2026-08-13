import dotenv from 'dotenv';

dotenv.config();

export type HmacKeyRing = Map<string, string>;

export interface EncoderConfig {
  port: number;
  mediaHost: string;
  publicBaseUrl: string;
  r2Endpoint: string;
  r2Region: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  callbackKeys: HmacKeyRing;
  maxConcurrent: number;
  tmpDir: string;
  maxSourceBytes: number;
  maxDurationSec: number;
  ffmpegPath: string;
  ffprobePath: string;
  watermarkLogoPath: string;
  watermarkLogoUrl: string;
  watermarkLogoWidth: number;
  watermarkFontPath: string;
  watermarkCycleSec: number;
  watermarkFadeSec: number;
  watermarkHoldSec: number;
  watermarkGapSec: number;
  watermarkPaddingPx: number;
}

function parseKeyRing(raw: string | undefined): HmacKeyRing {
  const map = new Map<string, string>();
  if (!raw?.trim()) return map;
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0) continue;
    const kid = trimmed.slice(0, idx).trim();
    const secret = trimmed.slice(idx + 1).trim();
    if (kid && secret) map.set(kid, secret);
  }
  return map;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(): EncoderConfig {
  const mediaHost = (process.env.VIDEO_MEDIA_HOST || 'media.dripdrop.social')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  return {
    port: intEnv('PORT', 8080),
    mediaHost,
    publicBaseUrl: `https://${mediaHost}`,
    r2Endpoint: process.env.R2_ENDPOINT || '',
    r2Region: process.env.R2_REGION || 'auto',
    r2AccessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    callbackKeys: parseKeyRing(process.env.ENCODER_CALLBACK_HMAC_KEYS),
    maxConcurrent: Math.max(1, intEnv('ENCODER_MAX_CONCURRENT', 1)),
    tmpDir: process.env.ENCODER_TMP_DIR || '/tmp/encoder',
    maxSourceBytes: intEnv('ENCODER_MAX_SOURCE_BYTES', 524288000),
    maxDurationSec: intEnv('ENCODER_MAX_DURATION_SEC', 180),
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
    ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
    watermarkLogoPath: process.env.WATERMARK_LOGO_PATH || './assets/logo-watermark.png',
    watermarkLogoUrl: process.env.WATERMARK_LOGO_URL || '',
    watermarkLogoWidth: intEnv('WATERMARK_LOGO_WIDTH', 160),
    watermarkFontPath:
      process.env.WATERMARK_FONT_PATH || '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    watermarkCycleSec: Number(process.env.WATERMARK_CYCLE_SEC || 5),
    watermarkFadeSec: Number(process.env.WATERMARK_FADE_SEC || 0.4),
    watermarkHoldSec: Number(process.env.WATERMARK_HOLD_SEC || 3.5),
    watermarkGapSec: Number(process.env.WATERMARK_GAP_SEC || 0.7),
    watermarkPaddingPx: Number(process.env.WATERMARK_PADDING_PX || 24),
  };
}

let cached: EncoderConfig | null = null;

export function getConfig(): EncoderConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

/** Test helper */
export function resetConfigCache(): void {
  cached = null;
}
