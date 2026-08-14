import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { validateExportMp4 } from './exportValidate';

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
});
