import fs from 'fs';
import path from 'path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getConfig } from '../config';
import { EncodeError } from '../types';

let client: S3Client | null = null;

export function getStreamsClient(): S3Client {
  const cfg = getConfig();
  if (!cfg.r2Endpoint || !cfg.r2AccessKeyId || !cfg.r2SecretAccessKey) {
    throw new EncodeError('UPLOAD_FAILED', 'R2 credentials not configured', false);
  }
  if (!client) {
    client = new S3Client({
      region: cfg.r2Region,
      endpoint: cfg.r2Endpoint,
      credentials: {
        accessKeyId: cfg.r2AccessKeyId,
        secretAccessKey: cfg.r2SecretAccessKey,
      },
      forcePathStyle: true,
    });
  }
  return client;
}

/** Test helper */
export function resetStreamsClient(): void {
  client = null;
}

function contentTypeFor(key: string): string {
  if (key.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (key.endsWith('.m4s')) return 'video/iso.segment';
  if (key.endsWith('.mp4')) return 'video/mp4';
  if (key.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

function cacheControlFor(key: string): string {
  if (key.endsWith('master.m3u8') || key.endsWith('playlist.m3u8')) {
    return 'public, max-age=60';
  }
  return 'public, max-age=31536000, immutable';
}

export type UploadItem = { localPath: string; key: string };

/**
 * Upload all objects under prefix. master.m3u8 must be last in `items`
 * (caller orders); this function also enforces that.
 */
export async function uploadPrefix(params: {
  bucket: string;
  prefix: string;
  items: UploadItem[];
  onOrdered?: (keys: string[]) => void;
}): Promise<string[]> {
  const { bucket, prefix, items } = params;
  if (!prefix.endsWith('/')) {
    throw new EncodeError('UPLOAD_FAILED', 'output.prefix must end with /', false);
  }

  const ordered = [...items];
  const masterIdx = ordered.findIndex((i) => i.key.endsWith('master.m3u8'));
  if (masterIdx >= 0 && masterIdx !== ordered.length - 1) {
    const [master] = ordered.splice(masterIdx, 1);
    ordered.push(master);
  }

  const keys: string[] = [];
  const s3 = getStreamsClient();

  for (const item of ordered) {
    if (!item.key.startsWith(prefix)) {
      throw new EncodeError('UPLOAD_FAILED', `Key outside prefix: ${item.key}`, false);
    }
    if (item.key.includes('..')) {
      throw new EncodeError('UPLOAD_FAILED', `Illegal key: ${item.key}`, false);
    }
    if (!fs.existsSync(item.localPath)) {
      throw new EncodeError('UPLOAD_FAILED', `Missing local file ${item.localPath}`, false);
    }

    try {
      const body = fs.readFileSync(item.localPath);
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: item.key,
          Body: body,
          ContentType: contentTypeFor(item.key),
          CacheControl: cacheControlFor(item.key),
        }),
      );
      keys.push(item.key);
    } catch (err) {
      throw new EncodeError('UPLOAD_FAILED', `PutObject ${item.key}: ${err}`, true);
    }
  }

  params.onOrdered?.(keys);
  return keys;
}

export function collectUploadItems(params: {
  workDir: string;
  prefix: string;
  renditionNames: string[];
}): UploadItem[] {
  const { workDir, prefix, renditionNames } = params;
  const items: UploadItem[] = [];

  for (const name of renditionNames) {
    const dir = path.join(workDir, name);
    for (const file of fs.readdirSync(dir)) {
      if (file === 'master.m3u8') continue;
      items.push({
        localPath: path.join(dir, file),
        key: `${prefix}${name}/${file}`,
      });
    }
  }

  for (const extra of ['fallback.mp4', 'poster.webp', 'thumbnail.webp']) {
    const localPath = path.join(workDir, extra);
    if (fs.existsSync(localPath)) {
      items.push({ localPath, key: `${prefix}${extra}` });
    }
  }

  items.push({
    localPath: path.join(workDir, 'master.m3u8'),
    key: `${prefix}master.m3u8`,
  });

  return items;
}
