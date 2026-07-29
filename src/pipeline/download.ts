import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { getConfig } from '../config';
import { EncodeError } from '../types';

export async function downloadSource(sourceUrl: string, destPath: string, sourceExpiresAt: string): Promise<number> {
  const cfg = getConfig();
  if (Date.parse(sourceExpiresAt) < Date.now()) {
    throw new EncodeError('SOURCE_EXPIRED', 'Source URL already expired', false);
  }

  let res: Response;
  try {
    res = await fetch(sourceUrl);
  } catch (err) {
    throw new EncodeError('SOURCE_DOWNLOAD_FAILED', `Download failed: ${err}`, true);
  }

  if (res.status === 403 || res.status === 401) {
    throw new EncodeError('SOURCE_EXPIRED', `Source GET ${res.status}`, false);
  }
  if (!res.ok || !res.body) {
    throw new EncodeError('SOURCE_DOWNLOAD_FAILED', `Source GET ${res.status}`, true);
  }

  const contentLength = Number(res.headers.get('content-length') || 0);
  if (contentLength > cfg.maxSourceBytes) {
    throw new EncodeError('SOURCE_TOO_LARGE', `Content-Length ${contentLength}`, false);
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const file = fs.createWriteStream(destPath);
  let written = 0;

  const nodeStream = Readable.fromWeb(res.body as import('stream/web').ReadableStream);
  nodeStream.on('data', (chunk: Buffer) => {
    written += chunk.length;
    if (written > cfg.maxSourceBytes) {
      nodeStream.destroy();
      file.destroy();
      try {
        fs.unlinkSync(destPath);
      } catch {
        /* ignore */
      }
    }
  });

  try {
    await pipeline(nodeStream, file);
  } catch (err) {
    if (written > cfg.maxSourceBytes) {
      throw new EncodeError('SOURCE_TOO_LARGE', `Exceeded ${cfg.maxSourceBytes}`, false);
    }
    throw new EncodeError('SOURCE_DOWNLOAD_FAILED', `Stream error: ${err}`, true);
  }

  if (written <= 0) {
    throw new EncodeError('SOURCE_DOWNLOAD_FAILED', 'Empty source', false);
  }
  return written;
}
