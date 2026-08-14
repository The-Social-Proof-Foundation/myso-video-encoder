import fs from 'fs';
import { EncodeError, ProbeResult } from '../types';
import { probeSource } from './probe';

const MIN_EXPORT_BYTES = 10 * 1024;
const DURATION_TOLERANCE = 0.1;

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

  const outProbe = await probeSource(filePath);
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

  const maxDur = sourceProbe.durationSec * (1 + DURATION_TOLERANCE);
  const minDur = sourceProbe.durationSec * (1 - DURATION_TOLERANCE);
  if (outProbe.durationSec < minDur || outProbe.durationSec > maxDur) {
    throw new EncodeError(
      'VALIDATION_FAILED',
      `Export duration ${outProbe.durationSec}s outside source range ${minDur.toFixed(2)}–${maxDur.toFixed(2)}s`,
      false,
    );
  }

  return outProbe;
}
