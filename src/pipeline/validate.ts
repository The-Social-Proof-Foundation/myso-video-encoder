import fs from 'fs';
import path from 'path';
import { EncodeError, EncodedRendition } from '../types';

function parsePlaylistUris(body: string): string[] {
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

export function validateLocalOutputs(params: {
  workDir: string;
  masterPath: string;
  renditions: EncodedRendition[];
  durationMs: number;
  maxDurationMs: number;
}): void {
  const { masterPath, renditions, durationMs, maxDurationMs } = params;
  if (durationMs <= 0 || durationMs > maxDurationMs) {
    throw new EncodeError('VALIDATION_FAILED', `duration out of range: ${durationMs}`, false);
  }
  if (!fs.existsSync(masterPath)) {
    throw new EncodeError('VALIDATION_FAILED', 'master.m3u8 missing', false);
  }
  const master = fs.readFileSync(masterPath, 'utf8');
  if (!master.includes('#EXTM3U') || !master.includes('#EXT-X-STREAM-INF')) {
    throw new EncodeError('VALIDATION_FAILED', 'invalid master', false);
  }

  for (const uri of parsePlaylistUris(master)) {
    if (/^https?:\/\//i.test(uri) || uri.includes('..')) {
      throw new EncodeError('VALIDATION_FAILED', `bad master uri: ${uri}`, false);
    }
    const keyPath = path.join(path.dirname(masterPath), uri);
    if (!fs.existsSync(keyPath)) {
      throw new EncodeError('VALIDATION_FAILED', `missing master ref ${uri}`, false);
    }
  }

  for (const r of renditions) {
    if (!fs.existsSync(r.playlistPath) || !fs.existsSync(r.initPath)) {
      throw new EncodeError('VALIDATION_FAILED', `missing outputs for ${r.name}`, false);
    }
    const playlist = fs.readFileSync(r.playlistPath, 'utf8');
    if (!playlist.includes('#EXT-X-ENDLIST')) {
      throw new EncodeError('VALIDATION_FAILED', `missing ENDLIST ${r.name}`, false);
    }
    const uris = parsePlaylistUris(playlist);
    let segments = 0;
    for (const uri of uris) {
      if (uri.includes('..') || /^https?:\/\//i.test(uri)) {
        throw new EncodeError('VALIDATION_FAILED', `bad playlist uri: ${uri}`, false);
      }
      const p = path.join(path.dirname(r.playlistPath), uri);
      if (!fs.existsSync(p)) {
        throw new EncodeError('VALIDATION_FAILED', `missing segment ${uri}`, false);
      }
      segments += 1;
    }
    if (segments < 1) {
      throw new EncodeError('VALIDATION_FAILED', `no segments ${r.name}`, false);
    }
    if (r.peakBandwidth < r.averageBandwidth) {
      throw new EncodeError('VALIDATION_FAILED', `BANDWIDTH < AVERAGE for ${r.name}`, false);
    }
    if (r.width % 2 !== 0 || r.height % 2 !== 0) {
      throw new EncodeError('VALIDATION_FAILED', `odd dims ${r.name}`, false);
    }
  }
}
