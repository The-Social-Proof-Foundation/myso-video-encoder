import { execFile } from 'child_process';
import { promisify } from 'util';
import { getConfig } from '../config';
import { EncodeError, ProbeResult } from '../types';

const execFileAsync = promisify(execFile);

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  color_transfer?: string;
  color_primaries?: string;
  pix_fmt?: string;
  side_data_list?: Array<{ rotation?: number | string; side_data_type?: string }>;
  tags?: Record<string, string>;
}

interface FfprobeJson {
  format?: { duration?: string };
  streams?: FfprobeStream[];
}

function parseFps(rate: string | undefined): number {
  if (!rate || rate === '0/0') return 30;
  const [a, b] = rate.split('/').map(Number);
  if (!b) return Number(rate) || 30;
  return a / b;
}

function readRotation(stream: FfprobeStream): number {
  const tag = stream.tags?.rotate || stream.tags?.ROTATE;
  if (tag != null && tag !== '') {
    const n = Number(tag);
    if (Number.isFinite(n)) return ((n % 360) + 360) % 360;
  }
  for (const sd of stream.side_data_list || []) {
    if (sd.rotation != null) {
      const n = Number(sd.rotation);
      if (Number.isFinite(n)) return ((n % 360) + 360) % 360;
    }
  }
  return 0;
}

function isHdr(stream: FfprobeStream): boolean {
  const t = (stream.color_transfer || '').toLowerCase();
  const p = (stream.color_primaries || '').toLowerCase();
  return t.includes('smpte2084') || t.includes('arib-std-b67') || p.includes('bt2020');
}

export function effectiveDims(width: number, height: number, rotation: number): { width: number; height: number } {
  if (rotation === 90 || rotation === 270) {
    return { width: height, height: width };
  }
  return { width, height };
}

export async function probeSource(filePath: string): Promise<ProbeResult> {
  const cfg = getConfig();
  let stdout: string;
  try {
    const out = await execFileAsync(
      cfg.ffprobePath,
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    stdout = out.stdout;
  } catch (err) {
    throw new EncodeError('PROBE_FAILED', `ffprobe failed: ${err}`, false);
  }

  const json = JSON.parse(stdout) as FfprobeJson;
  const video = (json.streams || []).find((s) => s.codec_type === 'video');
  const audio = (json.streams || []).find((s) => s.codec_type === 'audio');
  if (!video || !video.width || !video.height) {
    throw new EncodeError('NO_VIDEO', 'No video stream', false);
  }

  const durationSec = Number(json.format?.duration || 0);
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new EncodeError('PROBE_FAILED', 'Missing duration', false);
  }
  if (durationSec > cfg.maxDurationSec) {
    throw new EncodeError('DURATION_EXCEEDED', `Duration ${durationSec}s > ${cfg.maxDurationSec}s`, false);
  }

  const rotation = readRotation(video);
  const dims = effectiveDims(video.width, video.height, rotation);
  const fps = parseFps(video.avg_frame_rate || video.r_frame_rate);

  return {
    durationSec,
    width: dims.width,
    height: dims.height,
    rotation,
    hasAudio: Boolean(audio),
    hasVideo: true,
    fps,
    isHdr: isHdr(video),
    codecName: video.codec_name,
  };
}

/** Nearest allowed CFR, capped at 30. */
export function normalizeFps(sourceFps: number): number {
  const targets = [24000 / 1001, 24, 25, 30000 / 1001, 30];
  const capped = Math.min(sourceFps > 0 ? sourceFps : 30, 30);
  let best = targets[0];
  let bestDiff = Math.abs(capped - best);
  for (const t of targets) {
    const d = Math.abs(capped - t);
    if (d < bestDiff) {
      best = t;
      bestDiff = d;
    }
  }
  return best;
}

export function gopFramesForFps(fps: number): number {
  // ~2s closed GOP
  return Math.max(24, Math.round(fps * 2));
}

export function fpsFilterValue(fps: number): string {
  // ffmpeg fps filter prefers rational for NTSC
  if (Math.abs(fps - 24000 / 1001) < 0.01) return '24000/1001';
  if (Math.abs(fps - 30000 / 1001) < 0.01) return '30000/1001';
  return String(fps);
}
