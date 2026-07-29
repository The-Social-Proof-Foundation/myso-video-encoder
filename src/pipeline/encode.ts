import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { getConfig } from '../config';
import { EncodeError, EncodedRendition, LadderRung, ProbeResult } from '../types';
import { fpsFilterValue, gopFramesForFps, normalizeFps } from './probe';

const execFileAsync = promisify(execFile);

async function runFfmpeg(args: string[]): Promise<void> {
  const cfg = getConfig();
  try {
    await execFileAsync(cfg.ffmpegPath, args, {
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new EncodeError('ENCODE_FAILED', msg, false);
  }
}

function videoFilterChain(rung: LadderRung, fps: number, isHdr: boolean): string {
  const parts: string[] = [];
  // autorotate is applied by ffmpeg decoder when -noautorotate is NOT set (default)
  if (isHdr) {
    parts.push('zscale=t=linear:npl=100,format=gbrpf32le,tonemap=tonemap=hable:desat=0,zscale=p=bt709:t=bt709:m=bt709:r=tv,format=yuv420p');
  } else {
    parts.push('format=yuv420p');
  }
  parts.push(`scale=${rung.width}:${rung.height}:force_divisible_by=2`);
  parts.push(`fps=${fpsFilterValue(fps)}`);
  return parts.join(',');
}

function listSegments(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('segment_') && f.endsWith('.m4s'))
    .sort()
    .map((f) => path.join(dir, f));
}

function measureBandwidth(paths: string[], durationSec: number): { average: number; peak: number } {
  let totalBytes = 0;
  let peak = 0;
  for (const p of paths) {
    const st = fs.statSync(p);
    totalBytes += st.size;
    // Rough peak: largest file * 8 / ~2s segment
    const segBps = Math.ceil((st.size * 8) / 2);
    if (segBps > peak) peak = segBps;
  }
  const average = Math.max(1, Math.ceil((totalBytes * 8) / Math.max(durationSec, 0.001)));
  peak = Math.max(peak, Math.ceil(average * 1.1));
  return { average, peak };
}

/** H.264 High + AAC-LC codec string used in master playlist. */
export function codecString(hasAudio: boolean): string {
  // avc1.640028 ≈ High@L4.0; mp4a.40.2 = AAC-LC
  return hasAudio ? 'avc1.640028,mp4a.40.2' : 'avc1.640028';
}

export async function encodeRendition(params: {
  sourcePath: string;
  outDir: string;
  rung: LadderRung;
  probe: ProbeResult;
}): Promise<EncodedRendition> {
  const { sourcePath, outDir, rung, probe } = params;
  fs.mkdirSync(outDir, { recursive: true });
  const fps = normalizeFps(probe.fps);
  const gop = gopFramesForFps(fps);
  const vf = videoFilterChain(rung, fps, probe.isHdr);
  const playlistPath = path.join(outDir, 'playlist.m3u8');
  const segmentPattern = path.join(outDir, 'segment_%03d.m4s');

  const fullArgs: string[] = ['-y', '-i', sourcePath, '-map', '0:v:0'];

  if (probe.hasAudio) {
    fullArgs.push('-map', '0:a:0?', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2');
  } else {
    fullArgs.push('-an');
  }

  fullArgs.push(
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
    '-vf',
    vf,
    '-crf',
    String(rung.crf),
    '-maxrate',
    rung.maxrate,
    '-bufsize',
    rung.bufsize,
    '-g',
    String(gop),
    '-keyint_min',
    String(gop),
    '-sc_threshold',
    '0',
    '-f',
    'hls',
    '-hls_time',
    '2',
    '-hls_playlist_type',
    'vod',
    '-hls_flags',
    'independent_segments',
    '-hls_segment_type',
    'fmp4',
    '-hls_fmp4_init_filename',
    'init.mp4',
    '-hls_segment_filename',
    segmentPattern,
    playlistPath,
  );

  await runFfmpeg(fullArgs);

  const initPath = path.join(outDir, 'init.mp4');
  if (!fs.existsSync(playlistPath) || !fs.existsSync(initPath)) {
    throw new EncodeError('ENCODE_FAILED', `Missing HLS outputs for ${rung.name}`, false);
  }
  const segmentPaths = listSegments(outDir);
  if (segmentPaths.length < 1) {
    throw new EncodeError('ENCODE_FAILED', `No segments for ${rung.name}`, false);
  }

  // Ensure ENDLIST present
  let playlist = fs.readFileSync(playlistPath, 'utf8');
  if (!playlist.includes('#EXT-X-ENDLIST')) {
    playlist = `${playlist.trimEnd()}\n#EXT-X-ENDLIST\n`;
    fs.writeFileSync(playlistPath, playlist);
  }

  const bw = measureBandwidth([initPath, ...segmentPaths], probe.durationSec);
  return {
    name: rung.name,
    width: rung.width,
    height: rung.height,
    dir: outDir,
    playlistPath,
    initPath,
    segmentPaths,
    averageBandwidth: bw.average,
    peakBandwidth: bw.peak,
    codecs: codecString(probe.hasAudio),
  };
}

export function writeMasterPlaylist(params: {
  masterPath: string;
  renditions: EncodedRendition[];
  frameRate: number;
}): void {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:7'];
  const frameRate = params.frameRate.toFixed(3);
  // Highest quality first
  const sorted = [...params.renditions].sort((a, b) => b.height - a.height || b.width - a.width);
  for (const r of sorted) {
    const bandwidth = Math.max(r.peakBandwidth, r.averageBandwidth);
    const avg = Math.min(r.averageBandwidth, bandwidth);
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},AVERAGE-BANDWIDTH=${avg},RESOLUTION=${r.width}x${r.height},CODECS="${r.codecs}",FRAME-RATE=${frameRate}`,
    );
    lines.push(`${r.name}/playlist.m3u8`);
  }
  fs.writeFileSync(params.masterPath, `${lines.join('\n')}\n`);
}

export async function encodeFallbackMp4(params: {
  sourcePath: string;
  outPath: string;
  probe: ProbeResult;
  target: LadderRung;
}): Promise<void> {
  const fps = normalizeFps(params.probe.fps);
  const vf = videoFilterChain(params.target, fps, params.probe.isHdr);
  const args = [
    '-y',
    '-i',
    params.sourcePath,
    '-map',
    '0:v:0',
    ...(params.probe.hasAudio ? ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2'] : ['-an']),
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-vf',
    vf,
    '-crf',
    '21',
    '-movflags',
    '+faststart',
    params.outPath,
  ];
  await runFfmpeg(args);
}

export async function encodeStills(params: {
  sourcePath: string;
  posterPath: string;
  thumbnailPath: string;
  probe: ProbeResult;
}): Promise<void> {
  const t = Math.min(1, Math.max(0.1, params.probe.durationSec / 2));
  // poster: full-ish frame as webp
  await runFfmpeg([
    '-y',
    '-ss',
    String(t),
    '-i',
    params.sourcePath,
    '-frames:v',
    '1',
    '-vf',
    'scale=min(1080\\,iw):-2:force_original_aspect_ratio=decrease:force_divisible_by=2',
    params.posterPath,
  ]);
  await runFfmpeg([
    '-y',
    '-ss',
    String(t),
    '-i',
    params.sourcePath,
    '-frames:v',
    '1',
    '-vf',
    'scale=320:-2:force_original_aspect_ratio=decrease:force_divisible_by=2',
    params.thumbnailPath,
  ]);
}

/** Pick 720-class rung or closest for fallback. */
export function pickFallbackRung(rungs: LadderRung[]): LadderRung {
  return rungs.find((r) => r.name === '720') || rungs.find((r) => r.name === 'source') || rungs[0];
}
