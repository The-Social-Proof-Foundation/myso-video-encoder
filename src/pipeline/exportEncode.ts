import fs from 'fs';
import { getConfig } from '../config';
import { EncodeError, ProbeResult } from '../types';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  buildOverlayExpressions,
  DEFAULT_WATERMARK_TIMING,
  escapeDrawtext,
  WatermarkTiming,
} from './watermarkAnimation';

const execFileAsync = promisify(execFile);

/** Username row + padding below scaled logo (px). */
export const WATERMARK_USERNAME_ROW_PX = 36;

async function runFfmpeg(args: string[]): Promise<void> {
  const cfg = getConfig();
  try {
    await execFileAsync(cfg.ffmpegPath, args, { maxBuffer: 20 * 1024 * 1024 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new EncodeError('ENCODE_FAILED', msg, false);
  }
}

function loadWatermarkTiming(): WatermarkTiming {
  const cfg = getConfig();
  return {
    cycleSec: cfg.watermarkCycleSec,
    fadeSec: cfg.watermarkFadeSec,
    holdSec: cfg.watermarkHoldSec,
    gapSec: cfg.watermarkGapSec,
    paddingPx: cfg.watermarkPaddingPx,
  };
}

function fontDrawArg(): string {
  const cfg = getConfig();
  if (cfg.watermarkFontPath && fs.existsSync(cfg.watermarkFontPath)) {
    return `:fontfile=${cfg.watermarkFontPath}`;
  }
  return '';
}

/** Stacked brand PNG + centered username row for FFmpeg filter_complex. */
export function buildStackedWatermarkFilterComplex(params: {
  label: string;
  logoWidth: number;
  fontArg?: string;
}): string {
  const label = escapeDrawtext(params.label);
  const font = params.fontArg ?? '';
  const w = params.logoWidth;
  const canvasH = Math.ceil((w * 360) / 500) + WATERMARK_USERNAME_ROW_PX;
  const canvasW = Math.max(w + 16, 200);
  return (
    `[0:v]scale=${w}:-1[logo];` +
    `color=c=black@0.0:s=${canvasW}:${canvasH},format=rgba[bg];` +
    `[bg][logo]overlay=(W-w)/2:0[stacked];` +
    `[stacked]drawtext=text='${label}'${font}:` +
    `fontcolor=white@0.92:fontsize=20:` +
    `x=(w-text_w)/2:y=h-28:` +
    `shadowcolor=black@0.5:shadowx=1:shadowy=1[out]`
  );
}

/** Render transparent PNG strip: brand logo + creator label stacked vertically. */
export async function renderWatermarkStrip(params: {
  outPath: string;
  label: string;
  logoPath?: string;
}): Promise<void> {
  const cfg = getConfig();
  const logoPath = params.logoPath || cfg.watermarkLogoPath;
  if (!logoPath || !fs.existsSync(logoPath)) {
    throw new EncodeError(
      'VALIDATION_FAILED',
      `Watermark logo not found at ${logoPath || cfg.watermarkLogoPath}`,
      false,
    );
  }

  const filter = buildStackedWatermarkFilterComplex({
    label: params.label,
    logoWidth: cfg.watermarkLogoWidth,
    fontArg: fontDrawArg(),
  });

  await runFfmpeg([
    '-y',
    '-i',
    logoPath,
    '-filter_complex',
    filter,
    '-map',
    '[out]',
    '-c:v',
    'png',
    '-pix_fmt',
    'rgba',
    '-frames:v',
    '1',
    params.outPath,
  ]);
}

export async function encodeWatermarkedExport(params: {
  sourcePath: string;
  watermarkStripPath: string;
  outPath: string;
  probe: ProbeResult;
}): Promise<void> {
  const timing = loadWatermarkTiming();
  const { alphaExpr, xExpr, yExpr } = buildOverlayExpressions(timing);

  const filter =
    `[0:v]format=yuv420p[base];` +
    `[1:v]format=rgba,colorchannelmixer=aa='${alphaExpr}'[wm];` +
    `[base][wm]overlay=x='${xExpr}':y='${yExpr}':eval=frame:format=auto[outv]`;

  const args = [
    '-y',
    '-i',
    params.sourcePath,
    '-loop',
    '1',
    '-i',
    params.watermarkStripPath,
    '-filter_complex',
    filter,
    '-map',
    '[outv]',
    ...(params.probe.hasAudio
      ? ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2']
      : []),
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '21',
    '-movflags',
    '+faststart',
    '-shortest',
    params.outPath,
  ];

  await runFfmpeg(args);

  if (!fs.existsSync(params.outPath)) {
    throw new EncodeError('ENCODE_FAILED', 'Missing watermarked export output', false);
  }
}

export { DEFAULT_WATERMARK_TIMING };
