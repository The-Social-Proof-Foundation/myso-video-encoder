import fs from 'fs';
import { getConfig } from '../config';
import { EncodeError, ProbeResult } from '../types';
import { EXPORT_END_CARD_SEC } from './exportEncode';
import { probeSource } from './probe';

const MIN_EXPORT_BYTES = 10 * 1024;
const DURATION_TOLERANCE = 0.1;

export function expectedExportDurationSec(sourceDurationSec: number): number {
  return sourceDurationSec + EXPORT_END_CARD_SEC;
}

export function assertExportDuration(outDurationSec: number, sourceDurationSec: number): void {
  const expected = expectedExportDurationSec(sourceDurationSec);
  const maxDur = expected * (1 + DURATION_TOLERANCE);
  const minDur = expected * (1 - DURATION_TOLERANCE);
  if (outDurationSec < minDur || outDurationSec > maxDur) {
    throw new EncodeError(
      'VALIDATION_FAILED',
      `Export duration ${outDurationSec}s outside expected range ${minDur.toFixed(2)}–${maxDur.toFixed(2)}s`,
      false,
    );
  }
}

export function assertExportHasAudio(hasAudio: boolean): void {
  if (!hasAudio) {
    throw new EncodeError('VALIDATION_FAILED', 'Export MP4 has no audio stream', false);
  }
}

/** Ensure export MP4 is playable before upload (moov present, h264, sane duration). */
export async function validateExportMp4(
  filePath: string,
  sourceProbe: ProbeResult,
): Promise<ProbeResult> {
  if (!fs.existsSync(filePath)) {
    throw new EncodeError('VALIDATION_FAILED', 'Export MP4 missing', false);
  }
  const size = fs.statSync(filePath).size;
  if (size < MIN_EXPORT_BYTES) {
    throw new EncodeError('VALIDATION_FAILED', `Export MP4 too small (${size} bytes)`, false);
  }

  const cfg = getConfig();
  const outProbe = await probeSource(filePath, {
    maxDurationSec: cfg.maxDurationSec + EXPORT_END_CARD_SEC,
  });
  if (!outProbe.hasVideo) {
    throw new EncodeError('VALIDATION_FAILED', 'Export MP4 has no video stream', false);
  }
  if (outProbe.codecName !== 'h264') {
    throw new EncodeError(
      'VALIDATION_FAILED',
      `Export MP4 expected h264, got ${outProbe.codecName || 'unknown'}`,
      false,
    );
  }
  if (outProbe.width % 2 !== 0 || outProbe.height % 2 !== 0) {
    throw new EncodeError('VALIDATION_FAILED', 'Export MP4 has odd dimensions', false);
  }

  assertExportHasAudio(outProbe.hasAudio);
  assertExportDuration(outProbe.durationSec, sourceProbe.durationSec);

  return outProbe;
}
