import fs from 'fs';
import { getConfig } from '../config';
import { EncodeError, ProbeResult } from '../types';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  buildOverlayExpressions,
  buildWatermarkTimeline,
  DEFAULT_WATERMARK_TIMING,
  escapeDrawtext,
  escapeFilterExpr,
  WatermarkSlot,
  WatermarkTiming,
} from './watermarkAnimation';
import { fpsFilterValue, gopFramesForFps, normalizeFps } from './probe';

const execFileAsync = promisify(execFile);

/** Username row + padding below scaled logo (px). */
export const WATERMARK_USERNAME_ROW_PX = 36;

export const WATERMARKED_EXPORT_FILENAME = 'watermarked-v2.mp4';

export const EXPORT_END_CARD_SEC = 2;

export const EXPORT_END_CARD_LOGO_WIDTH = 360;

export const EXPORT_BODY_FILENAME = 'export-body.mp4';
export const EXPORT_CARD_FILENAME = 'export-card.mp4';

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
  timeline?: WatermarkSlot[],
): string {
  const { geqAlphaExpr, xExpr, yExpr } = buildOverlayExpressions(timing, timeline);
  const fpsVal = fpsFilterValue(normalizeFps(fps));
  const a = escapeFilterExpr(geqAlphaExpr);
  return (
    `[0:v]format=gbrp,fps=${fpsVal}[base];` +
    `[1:v]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${a})'[wm];` +
    `[base][wm]overlay=x='${escapeFilterExpr(xExpr)}':y='${escapeFilterExpr(yExpr)}':eval=frame:format=gbrp:alpha=straight,format=yuv420p[outv]`
  );
}

function audioEncodeArgs(): string[] {
  return ['-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2'];
}

/** FFmpeg args for watermarked export encode (testable). */
export function buildWatermarkedExportFfmpegArgs(params: {
  sourcePath: string;
  watermarkStripPath: string;
  outPath: string;
  probe: ProbeResult;
  timing?: WatermarkTiming;
  timeline?: WatermarkSlot[];
}): string[] {
  const timing = params.timing ?? DEFAULT_WATERMARK_TIMING;
  const fps = normalizeFps(params.probe.fps);
  const gop = gopFramesForFps(fps);
  const timeline =
    params.timeline ??
    buildWatermarkTimeline({ durationSec: params.probe.durationSec, timing });
  const filter = buildWatermarkedExportFilterComplex(timing, fps, timeline);
  const duration = String(params.probe.durationSec);

  const silentPad = params.probe.hasAudio
    ? []
    : ['-f', 'lavfi', '-t', duration, '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000'];
  const audioMap = params.probe.hasAudio
    ? ['-map', '0:a:0?', ...audioEncodeArgs()]
    : ['-map', '2:a:0', ...audioEncodeArgs()];

  return [
    '-y',
    '-i',
    params.sourcePath,
    '-loop',
    '1',
    '-i',
    params.watermarkStripPath,
    ...silentPad,
    '-filter_complex',
    filter,
    '-map',
    '[outv]',
    ...audioMap,
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
    duration,
    '-shortest',
    '-f',
    'mp4',
    params.outPath,
  ];
}

export function buildEndCardFilterComplex(): string {
  return (
    `[0:v]format=gbrp[base];` +
    `[1:v]format=rgba[wm];` +
    `[base][wm]overlay=x=(W-w)/2:y=(H-h)/2:format=gbrp:alpha=straight,format=yuv420p[outv]`
  );
}

export function buildEndCardFfmpegArgs(params: {
  watermarkStripPath: string;
  chimePath: string;
  outPath: string;
  probe: ProbeResult;
  durationSec?: number;
}): string[] {
  const duration = params.durationSec ?? EXPORT_END_CARD_SEC;
  const fps = normalizeFps(params.probe.fps);
  const fpsVal = fpsFilterValue(fps);
  const gop = gopFramesForFps(fps);
  const w = params.probe.width;
  const h = params.probe.height;

  return [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=${w}x${h}:d=${duration}:r=${fpsVal}`,
    '-loop',
    '1',
    '-i',
    params.watermarkStripPath,
    '-i',
    params.chimePath,
    '-filter_complex',
    buildEndCardFilterComplex(),
    '-map',
    '[outv]',
    '-map',
    '2:a:0',
    ...audioEncodeArgs(),
    '-af',
    'apad',
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
    String(duration),
    '-shortest',
    '-f',
    'mp4',
    params.outPath,
  ];
}

export function buildConcatListContents(files: string[]): string {
  return files.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join('\n') + '\n';
}

/** Temp path used during encode; rename to final after validation. */
export function watermarkedExportTempPath(outPath: string): string {
  return `${outPath}.tmp`;
}

export function resolveWatermarkChimePath(): string {
  const cfg = getConfig();
  if (!cfg.watermarkChimePath || !fs.existsSync(cfg.watermarkChimePath)) {
    throw new EncodeError(
      'VALIDATION_FAILED',
      `Watermark chime not found at ${cfg.watermarkChimePath || '(empty)'}`,
      false,
    );
  }
  return cfg.watermarkChimePath;
}

/** Render transparent PNG strip: brand logo + creator label stacked vertically. */
export async function renderWatermarkStrip(params: {
  outPath: string;
  label: string;
  logoPath?: string;
  logoWidth?: number;
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
    logoWidth: params.logoWidth ?? cfg.watermarkLogoWidth,
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
  try {
    if (fs.existsSync(params.outPath)) fs.unlinkSync(params.outPath);
  } catch {
    /* ignore */
  }

  const timing = loadWatermarkTiming();
  const timeline = buildWatermarkTimeline({
    durationSec: params.probe.durationSec,
    timing,
  });
  const args = buildWatermarkedExportFfmpegArgs({
    ...params,
    timing,
    timeline,
  });

  await runFfmpeg(args);

  if (!fs.existsSync(params.outPath)) {
    throw new EncodeError('ENCODE_FAILED', 'Missing watermarked export body output', false);
  }
}

export async function encodeExportEndCard(params: {
  watermarkStripPath: string;
  outPath: string;
  probe: ProbeResult;
}): Promise<void> {
  const chimePath = resolveWatermarkChimePath();
  try {
    if (fs.existsSync(params.outPath)) fs.unlinkSync(params.outPath);
  } catch {
    /* ignore */
  }

  const args = buildEndCardFfmpegArgs({
    watermarkStripPath: params.watermarkStripPath,
    chimePath,
    outPath: params.outPath,
    probe: params.probe,
  });
  await runFfmpeg(args);

  if (!fs.existsSync(params.outPath)) {
    throw new EncodeError('ENCODE_FAILED', 'Missing export end-card output', false);
  }
}

export async function concatExportSegments(params: {
  bodyPath: string;
  cardPath: string;
  outPath: string;
}): Promise<void> {
  const listPath = `${params.outPath}.concat.txt`;
  fs.writeFileSync(listPath, buildConcatListContents([params.bodyPath, params.cardPath]));
  try {
    if (fs.existsSync(params.outPath)) fs.unlinkSync(params.outPath);
  } catch {
    /* ignore */
  }

  await runFfmpeg([
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    params.outPath,
  ]);

  if (!fs.existsSync(params.outPath)) {
    throw new EncodeError('ENCODE_FAILED', 'Missing concat export output', false);
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

export { DEFAULT_WATERMARK_TIMING, loadWatermarkTiming };
