import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  assertExportDuration,
  assertExportHasAudio,
  expectedExportDurationSec,
  validateExportMp4,
} from './exportValidate';
import { EXPORT_END_CARD_SEC } from './exportEncode';
import { EncodeError } from '../types';

describe('validateExportMp4', () => {
  const sourceProbe = {
    durationSec: 6.2,
    width: 720,
    height: 1280,
    rotation: 0,
    hasAudio: false,
    hasVideo: true,
    fps: 30,
    isHdr: false,
    codecName: 'h264',
  };

  it('rejects missing file', async () => {
    await assert.rejects(
      () => validateExportMp4('/no/such/watermarked.mp4', sourceProbe),
      (err: unknown) => {
        assert.match(String(err), /Export MP4 missing/);
        return true;
      },
    );
  });

  it('rejects file smaller than minimum size', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-val-'));
    const file = path.join(dir, 'tiny.mp4');
    fs.writeFileSync(file, Buffer.alloc(100));
    try {
      await assert.rejects(
        () => validateExportMp4(file, sourceProbe),
        (err: unknown) => {
          assert.match(String(err), /too small/);
          return true;
        },
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('expects source duration plus end card', () => {
    assert.equal(expectedExportDurationSec(6.2), 6.2 + EXPORT_END_CARD_SEC);
    assert.doesNotThrow(() => assertExportDuration(8.2, 6.2));
    assert.throws(
      () => assertExportDuration(6.2, 6.2),
      (err: unknown) => {
        assert.ok(err instanceof EncodeError);
        assert.match(String(err), /outside expected range/);
        return true;
      },
    );
  });

  it('requires an audio stream', () => {
    assert.doesNotThrow(() => assertExportHasAudio(true));
    assert.throws(
      () => assertExportHasAudio(false),
      (err: unknown) => {
        assert.ok(err instanceof EncodeError);
        assert.match(String(err), /no audio stream/);
        return true;
      },
    );
  });
});
