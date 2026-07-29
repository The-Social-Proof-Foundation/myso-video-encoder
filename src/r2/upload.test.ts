import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { collectUploadItems } from './upload';

test('collectUploadItems puts master.m3u8 last', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enc-up-'));
  try {
    fs.mkdirSync(path.join(dir, '720'));
    fs.writeFileSync(path.join(dir, '720', 'playlist.m3u8'), '#EXTM3U\n');
    fs.writeFileSync(path.join(dir, '720', 'init.mp4'), 'x');
    fs.writeFileSync(path.join(dir, '720', 'segment_000.m4s'), 'y');
    fs.writeFileSync(path.join(dir, 'fallback.mp4'), 'f');
    fs.writeFileSync(path.join(dir, 'poster.webp'), 'p');
    fs.writeFileSync(path.join(dir, 'thumbnail.webp'), 't');
    fs.writeFileSync(path.join(dir, 'master.m3u8'), '#EXTM3U\n');

    const items = collectUploadItems({
      workDir: dir,
      prefix: 'vid_test/',
      renditionNames: ['720'],
    });
    assert.ok(items.length >= 5);
    assert.equal(items[items.length - 1].key, 'vid_test/master.m3u8');
    assert.ok(items.every((i, idx) => idx === items.length - 1 || !i.key.endsWith('master.m3u8')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
