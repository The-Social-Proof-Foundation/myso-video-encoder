import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config';
import { sendCallback } from '../callback/send';
import { collectUploadItems, uploadPrefix } from '../r2/upload';
import {
  EncodeError,
  EncoderFailureCallback,
  EncoderJobRequest,
  EncoderSuccessCallback,
  PROFILE,
} from '../types';
import { downloadSource } from './download';
import {
  encodeFallbackMp4,
  encodeRendition,
  encodeStills,
  pickFallbackRung,
  writeMasterPlaylist,
} from './encode';
import { buildLadder } from './ladder';
import { normalizeFps, probeSource } from './probe';
import { validateLocalOutputs } from './validate';

function assertRequestShape(req: EncoderJobRequest): void {
  if (req.profile !== PROFILE) {
    throw new EncodeError('PROFILE_UNSUPPORTED', `Unsupported profile ${req.profile}`, false);
  }
  const expectedPrefix = `${req.assetId}/`;
  if (req.output?.prefix !== expectedPrefix) {
    throw new EncodeError('VALIDATION_FAILED', `output.prefix must be ${expectedPrefix}`, false);
  }
  if (!req.output?.bucket || !req.callbackUrl || !req.sourceUrl || !req.jobId || !req.assetId) {
    throw new EncodeError('VALIDATION_FAILED', 'Missing required job fields', false);
  }
}

async function failCallback(
  encoderJobId: string,
  req: EncoderJobRequest,
  err: unknown,
): Promise<never> {
  const encodeErr =
    err instanceof EncodeError
      ? err
      : new EncodeError('ENCODE_FAILED', err instanceof Error ? err.message : String(err), true);

  const payload: EncoderFailureCallback = {
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
    console.error('[encoder] failure callback error', cbErr);
  }
  throw encodeErr;
}

export async function runEncodeJob(encoderJobId: string, req: EncoderJobRequest): Promise<void> {
  const cfg = getConfig();
  const workDir = path.join(cfg.tmpDir, 'jobs', encoderJobId);

  try {
    assertRequestShape(req);
    fs.mkdirSync(workDir, { recursive: true });

    const sourcePath = path.join(workDir, 'source.bin');
    await downloadSource(req.sourceUrl, sourcePath, req.sourceExpiresAt);

    const probe = await probeSource(sourcePath);
    const ladder = buildLadder(probe.width, probe.height);
    const renditions = [];

    for (const rung of ladder) {
      const outDir = path.join(workDir, rung.name);
      const encoded = await encodeRendition({
        sourcePath,
        outDir,
        rung,
        probe,
      });
      renditions.push(encoded);
    }

    const fallbackRung = pickFallbackRung(ladder);
    await encodeFallbackMp4({
      sourcePath,
      outPath: path.join(workDir, 'fallback.mp4'),
      probe,
      target: fallbackRung,
    });
    await encodeStills({
      sourcePath,
      posterPath: path.join(workDir, 'poster.webp'),
      thumbnailPath: path.join(workDir, 'thumbnail.webp'),
      probe,
    });

    const masterPath = path.join(workDir, 'master.m3u8');
    writeMasterPlaylist({
      masterPath,
      renditions,
      frameRate: normalizeFps(probe.fps),
    });

    const durationMs = Math.round(probe.durationSec * 1000);
    validateLocalOutputs({
      workDir,
      masterPath,
      renditions,
      durationMs,
      maxDurationMs: cfg.maxDurationSec * 1000,
    });

    const items = collectUploadItems({
      workDir,
      prefix: req.output.prefix,
      renditionNames: renditions.map((r) => r.name),
    });
    await uploadPrefix({
      bucket: req.output.bucket,
      prefix: req.output.prefix,
      items,
    });

    const top = [...renditions].sort((a, b) => b.height - a.height || b.width - a.width)[0];
    const success: EncoderSuccessCallback = {
      eventId: crypto.randomUUID(),
      jobId: req.jobId,
      encoderJobId,
      assetId: req.assetId,
      status: 'succeeded',
      hlsUrl: `${cfg.publicBaseUrl}/${req.assetId}/master.m3u8`,
      durationMs,
      width: top.width,
      height: top.height,
      renditions: renditions.map((r) => ({
        name: r.name,
        playlistKey: `${req.output.prefix}${r.name}/playlist.m3u8`,
        initKey: `${req.output.prefix}${r.name}/init.mp4`,
      })),
      fallbackKey: `${req.output.prefix}fallback.mp4`,
      posterKey: `${req.output.prefix}poster.webp`,
      thumbnailKey: `${req.output.prefix}thumbnail.webp`,
    };

    await sendCallback(req.callbackUrl, success);
  } catch (err) {
    await failCallback(encoderJobId, req, err);
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
