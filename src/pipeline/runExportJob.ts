import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config';
import { sendCallback } from '../callback/send';
import { uploadPrefix } from '../r2/upload';
import {
  EncodeError,
  EncoderExportFailureCallback,
  EncoderExportSuccessCallback,
  EncoderJobRequest,
  EXPORT_PROFILE,
} from '../types';
import { downloadSource } from './download';
import {
  encodeWatermarkedExport,
  finalizeWatermarkedExport,
  renderWatermarkStrip,
  WATERMARKED_EXPORT_FILENAME,
  watermarkedExportTempPath,
} from './exportEncode';
import { validateExportMp4 } from './exportValidate';
import { resolveWatermarkLogoPath } from './watermarkLogo';
import { probeSource } from './probe';

function assertExportRequestShape(req: EncoderJobRequest): void {
  if (req.profile !== EXPORT_PROFILE) {
    throw new EncodeError('PROFILE_UNSUPPORTED', `Unsupported profile ${req.profile}`, false);
  }
  const expectedPrefix = `${req.assetId}/`;
  if (req.output?.prefix !== expectedPrefix) {
    throw new EncodeError('VALIDATION_FAILED', `output.prefix must be ${expectedPrefix}`, false);
  }
  if (!req.watermark?.label?.trim()) {
    throw new EncodeError('VALIDATION_FAILED', 'watermark.label is required', false);
  }
  if (!req.output?.bucket || !req.callbackUrl || !req.sourceUrl || !req.jobId || !req.assetId) {
    throw new EncodeError('VALIDATION_FAILED', 'Missing required job fields', false);
  }
}

async function failExportCallback(
  encoderJobId: string,
  req: EncoderJobRequest,
  err: unknown,
): Promise<never> {
  const encodeErr =
    err instanceof EncodeError
      ? err
      : new EncodeError('ENCODE_FAILED', err instanceof Error ? err.message : String(err), true);

  const payload: EncoderExportFailureCallback = {
    eventId: crypto.randomUUID(),
    jobId: req.jobId,
    encoderJobId,
    assetId: req.assetId,
    status: 'failed',
    errorCode: encodeErr.errorCode,
    retryable: encodeErr.retryable,
  };

  try {
    await sendCallback(req.callbackUrl, payload);
  } catch (cbErr) {
    console.error('[encoder] export failure callback error', cbErr);
  }
  throw encodeErr;
}

export async function runExportJob(encoderJobId: string, req: EncoderJobRequest): Promise<void> {
  const cfg = getConfig();
  const workDir = path.join(cfg.tmpDir, 'jobs', encoderJobId);

  try {
    assertExportRequestShape(req);
    fs.mkdirSync(workDir, { recursive: true });

    const sourcePath = path.join(workDir, 'fallback.mp4');
    await downloadSource(req.sourceUrl, sourcePath, req.sourceExpiresAt);

    const probe = await probeSource(sourcePath);
    const logoPath = await resolveWatermarkLogoPath(workDir);
    const watermarkStripPath = path.join(workDir, 'watermark.png');
    await renderWatermarkStrip({
      outPath: watermarkStripPath,
      label: req.watermark!.label,
      logoPath,
    });

    const outPath = path.join(workDir, WATERMARKED_EXPORT_FILENAME);
    await encodeWatermarkedExport({
      sourcePath,
      watermarkStripPath,
      outPath,
      probe,
    });
    await validateExportMp4(watermarkedExportTempPath(outPath), probe);
    finalizeWatermarkedExport(outPath);

    const exportKey = `${req.output.prefix}${WATERMARKED_EXPORT_FILENAME}`;
    await uploadPrefix({
      bucket: req.output.bucket,
      prefix: req.output.prefix,
      items: [{ localPath: outPath, key: exportKey }],
    });

    const payload: EncoderExportSuccessCallback = {
      eventId: crypto.randomUUID(),
      jobId: req.jobId,
      encoderJobId,
      assetId: req.assetId,
      status: 'succeeded',
      exportKey,
      durationMs: Math.round(probe.durationSec * 1000),
      width: probe.width,
      height: probe.height,
    };

    await sendCallback(req.callbackUrl, payload);
  } catch (err) {
    await failExportCallback(encoderJobId, req, err);
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
