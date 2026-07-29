#!/usr/bin/env node
/**
 * Local smoke: tiny fixture → encoder → mock callback → R2 streams.
 * Requires: ffmpeg, encoder .env with R2 + HMAC keys, encoder listening on PORT.
 */
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const port = Number(process.env.SMOKE_ENCODER_PORT || 8099);
const srcPort = 8765;
const cbPort = 8766;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'enc-smoke-'));
const fixture = path.join(tmp, 'src.mp4');
const cbFile = path.join(tmp, 'cb.json');

execFileSync(
  'ffmpeg',
  [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=720x1280:rate=30',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000',
    '-t',
    '3',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    fixture,
  ],
  { stdio: 'ignore' },
);

async function main() {
  const staticServer = http.createServer((req, res) => {
    if (req.url === '/src.mp4') {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      fs.createReadStream(fixture).pipe(res);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => staticServer.listen(srcPort, '127.0.0.1', r));

  const cbServer = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      fs.writeFileSync(cbFile, body);
      console.log('callback received', body.toString('utf8').slice(0, 300));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise((r) => cbServer.listen(cbPort, '127.0.0.1', r));

  const enc = spawn('node', ['dist/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  enc.stdout.on('data', (d) => process.stdout.write(`[enc] ${d}`));
  enc.stderr.on('data', (d) => process.stderr.write(`[enc] ${d}`));

  async function waitHealth() {
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`);
        if (res.ok) return;
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('encoder health timeout');
  }

  try {
    await waitHealth();
    const jobId = crypto.randomUUID();
    const assetId = `vid_smoke_${Date.now()}`;
    const body = {
      jobId,
      assetId,
      profile: 'dripdrop-social-v1',
      sourceUrl: `http://127.0.0.1:${srcPort}/src.mp4`,
      sourceExpiresAt: '2030-01-01T00:00:00.000Z',
      output: {
        bucket: process.env.VIDEO_STREAMS_BUCKET || 'dripdrop-video-streams-dev',
        prefix: `${assetId}/`,
      },
      callbackUrl: `http://127.0.0.1:${cbPort}/callback`,
    };
    const submit = await fetch(`http://127.0.0.1:${port}/v1/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': jobId,
      },
      body: JSON.stringify(body),
    });
    const submitJson = await submit.json();
    console.log('submit', submit.status, submitJson);
    if (!submit.ok) throw new Error('submit failed');

    for (let i = 0; i < 90; i++) {
      if (fs.existsSync(cbFile)) {
        const payload = JSON.parse(fs.readFileSync(cbFile, 'utf8'));
        console.log('final callback status', payload.status, payload.errorCode || payload.hlsUrl);
        if (payload.status !== 'succeeded') {
          process.exitCode = 1;
        } else {
          console.log('SMOKE OK', payload.hlsUrl);
        }
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    console.error('callback timeout');
    process.exitCode = 1;
  } finally {
    enc.kill('SIGTERM');
    staticServer.close();
    cbServer.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

await main();
