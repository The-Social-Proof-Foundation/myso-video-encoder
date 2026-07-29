import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeMasterPlaylist } from './encode';
import { EncodedRendition } from '../types';

test('master BANDWIDTH >= AVERAGE-BANDWIDTH', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enc-bw-'));
  try {
    const masterPath = path.join(dir, 'master.m3u8');
    const renditions: EncodedRendition[] = [
      {
        name: '720',
        width: 720,
        height: 1280,
        dir: path.join(dir, '720'),
        playlistPath: path.join(dir, '720', 'playlist.m3u8'),
        initPath: path.join(dir, '720', 'init.mp4'),
        segmentPaths: [],
        averageBandwidth: 1_000_000,
        peakBandwidth: 1_200_000,
        codecs: 'avc1.640028,mp4a.40.2',
      },
    ];
    writeMasterPlaylist({ masterPath, renditions, frameRate: 30 });
    const body = fs.readFileSync(masterPath, 'utf8');
    const m = body.match(/BANDWIDTH=(\d+),AVERAGE-BANDWIDTH=(\d+)/);
    assert.ok(m);
    assert.ok(Number(m![1]) >= Number(m![2]));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
