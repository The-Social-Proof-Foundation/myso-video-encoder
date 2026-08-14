import fs from 'fs';
import path from 'path';
import { getConfig } from '../config';
import { EncodeError, ProbeResult } from '../types';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  buildOverlayExpressions,
  DEFAULT_WATERMARK_TIMING,
  escapeDrawtext,
  escapeFilterExpr,
  WatermarkTiming,
} from './watermarkAnimation';
import { fpsFilterValue, gopFramesForFps, normalizeFps } from './probe';

const execFileAsync = promisify(execFile);

/** Username row + padding below scaled logo (px). */
export const WATERMARK_USERNAME_ROW_PX = 36;

export const WATERMARKED_EXPORT_FILENAME = 'watermarked.mp4';

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

/** Font size scaled with logo display width. */
export function watermarkFontSize(logoWidth: number): number {
  return Math.round(20 * (logoWidth / 160));
}

/** Stacked brand PNG + centered username row for FFmpeg filter_complex. */
export function buildStackedWatermarkFilterComplex(params: {
  label: string;
  logoWidth: number;
  fontArg?: string;
  usernameRowPx?: number;
}): string {
  const label = escapeDrawtext(params.label);
  const font = params.fontArg ?? '';
  const w = params.logoWidth;
  const rowPx = params.usernameRowPx ?? WATERMARK_USERNAME_ROW_PX;
  const fontSize = watermarkFontSize(w);
  return (
    `[0:v]format=rgba,scale=${w}:-1:flags=lanczos+accurate_rnd[logo];` +
    `[logo]pad=w=iw:h=ih+${rowPx}:x=0:y=0:color=0x00000000[stacked];` +
    `[stacked]drawtext=text='${label}'${font}:` +
    `fontcolor=white@0.92:fontsize=${fontSize}:` +
    `x=(w-text_w)/2:y=h-28:` +
    `box=0:` +
    `shadowcolor=black@0.5:shadowx=1:shadowy=1[out]`
  );
}

/** filter_complex for animated watermark overlay (testable). */
export function buildWatermarkedExportFilterComplex(
  timing: WatermarkTiming = DEFAULT_WATERMARK_TIMING,
  fps: number = 30,
): string {
  const { geqAlphaExpr, xExpr, yExpr } = buildOverlayExpressions(timing);
  const fpsVal = fpsFilterValue(normalizeFps(fps));
  const a = escapeFilterExpr(geqAlphaExpr);
  return (
    `[0:v]format=yuv420p,fps=${fpsVal}[base];` +
    `[1:v]format=rgba,geq=r='r(X,Y)*(${a})':g='g(X,Y)*(${a})':b='b(X,Y)*(${a})':a='255*(${a})'[wm];` +
    `[base][wm]overlay=x='${escapeFilterExpr(xExpr)}':y='${escapeFilterExpr(yExpr)}':eval=frame:format=auto:alpha=premultiplied[outv]`
  );
}

/** FFmpeg args for watermarked export encode (testable). */
export function buildWatermarkedExportFfmpegArgs(params: {
  sourcePath: string;
  watermarkStripPath: string;
  outPath: string;
  probe: ProbeResult;
  timing?: WatermarkTiming;
}): string[] {
  const timing = params.timing ?? DEFAULT_WATERMARK_TIMING;
  const fps = normalizeFps(params.probe.fps);
  const gop = gopFramesForFps(fps);
  const filter = buildWatermarkedExportFilterComplex(timing, fps);

  return [
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
      : ['-an']),
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    '-level',
    '4.0',
    '-pix_fmt',
    'yuv420p',
    '-colorspace',
    'bt709',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-g',
    String(gop),
    '-preset',
    'medium',
    '-crf',
    '21',
    '-movflags',
    '+faststart',
    '-t',
    String(params.probe.durationSec),
    '-shortest',
    '-f',
    'mp4',
    params.outPath,
  ];
}

/** Temp path used during encode; rename to final after validation. */
export function watermarkedExportTempPath(outPath: string): string {
  return `${outPath}.tmp`;
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
  const tmpPath = watermarkedExportTempPath(params.outPath);
  try {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  } catch {
    /* ignore */
  }

  const args = buildWatermarkedExportFfmpegArgs({
    ...params,
    outPath: tmpPath,
  });

  await runFfmpeg(args);

  if (!fs.existsSync(tmpPath)) {
    throw new EncodeError('ENCODE_FAILED', 'Missing watermarked export temp output', false);
  }
}

/** Move validated temp export to final path. */
export function finalizeWatermarkedExport(outPath: string): void {
  const tmpPath = watermarkedExportTempPath(outPath);
  if (!fs.existsSync(tmpPath)) {
    throw new EncodeError('VALIDATION_FAILED', 'Missing validated export temp file', false);
  }
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  fs.renameSync(tmpPath, outPath);
}

export { DEFAULT_WATERMARK_TIMING };
