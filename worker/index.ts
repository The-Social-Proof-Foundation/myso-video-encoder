import { Container, getContainer } from '@cloudflare/containers';
import { encoderPoolName } from '../src/cf/encoderPool';

export interface Env {
  VIDEO_ENCODER: DurableObjectNamespace;
  VIDEO_BUCKET: R2Bucket;
  VIDEO_MEDIA_HOST?: string;
  R2_ENDPOINT?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_REGION?: string;
  ENCODER_CALLBACK_HMAC_KEYS?: string;
  ENCODER_MAX_CONCURRENT?: string;
  ENCODER_TMP_DIR?: string;
  ENCODER_MAX_SOURCE_BYTES?: string;
  ENCODER_MAX_DURATION_SEC?: string;
}

interface JobHandleCache {
  status: string;
  encoderJobId: string;
  jobId: string;
  updatedAt: string;
}

export function buildContainerEnv(env: Env): Record<string, string> {
  const vars: Record<string, string> = {
    PORT: '8080',
    ENCODER_TMP_DIR: env.ENCODER_TMP_DIR || '/tmp/encoder',
    R2_REGION: env.R2_REGION || 'auto',
    ENCODER_MAX_CONCURRENT: env.ENCODER_MAX_CONCURRENT || '1',
    ENCODER_EXIT_WHEN_IDLE_SEC: '60',
  };

  const optional: (keyof Env)[] = [
    'VIDEO_MEDIA_HOST',
    'R2_ENDPOINT',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'ENCODER_CALLBACK_HMAC_KEYS',
    'ENCODER_MAX_SOURCE_BYTES',
    'ENCODER_MAX_DURATION_SEC',
  ];

  for (const key of optional) {
    const value = env[key];
    if (typeof value === 'string' && value.length > 0) {
      vars[key] = value;
    }
  }

  return vars;
}

function jobCacheKey(idempotencyKey: string): string {
  return `job:${idempotencyKey}`;
}

/** Hard ceiling on container uptime after the latest request, independent of sleepAfter. */
export const HARD_STOP_AFTER_SEC = 15 * 60;
const HARD_STOP_CALLBACK = 'hardStop';

export class VideoEncoder extends Container {
  defaultPort = 8080;
  /**
   * HTTP-idle fallback. Must cover a full encode: the 202 returns before ffmpeg,
   * so a short sleepAfter SIGKILLs in-flight jobs. Matches HARD_STOP_AFTER_SEC.
   * onActivityExpired uses destroy(), not SIGTERM.
   */
  sleepAfter = '15m';
  enableInternet = true;
  pingEndpoint = '/health';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Rollout-warmed containers never hit fetch(); arm the deadline from DO boot.
    void this.ctx.blockConcurrencyWhile(async () => {
      if (this.ctx.container?.running) {
        await this.armHardStop();
      }
    });
  }

  /**
   * Persisted in DO SQLite so it survives a cancelled request or a DO restart.
   * The insert inside schedule() runs before its first await.
   */
  private async armHardStop(): Promise<void> {
    this.deleteSchedules(HARD_STOP_CALLBACK);
    await this.schedule(HARD_STOP_AFTER_SEC, HARD_STOP_CALLBACK);
  }

  async hardStop(): Promise<void> {
    await this.forceDestroy('hard stop deadline');
  }

  override async onStart(): Promise<void> {
    await this.armHardStop();
  }

  override async onActivityExpired(): Promise<void> {
    await this.forceDestroy('sleepAfter expired');
  }

  override onStop(): void {
    this.deleteSchedules(HARD_STOP_CALLBACK);
  }

  private async forceDestroy(reason: string): Promise<void> {
    if (!this.ctx.container?.running) return;
    console.warn(`[encoder] ${reason}, destroying container`);
    // SIGKILL — SIGTERM is unreliable for node as PID 1 and the SDK renews sleepAfter after stop().
    await this.destroy();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true, service: 'myso-video-encoder' });
    }

    if (request.method === 'POST' && url.pathname === '/v1/jobs') {
      const idempotencyKey = String(request.headers.get('Idempotency-Key') || '').trim();
      if (idempotencyKey) {
        const cached = await this.ctx.storage.get<JobHandleCache>(jobCacheKey(idempotencyKey));
        if (cached?.status === 'succeeded') {
          return Response.json(
            {
              encoderJobId: cached.encoderJobId,
              jobId: cached.jobId,
              status: cached.status,
            },
            { status: 200 },
          );
        }
      }
    }

    await this.armHardStop();

    await this.startAndWaitForPorts({
      startOptions: { envVars: buildContainerEnv(this.env as Env) },
      cancellationOptions: { portReadyTimeoutMS: 120_000 },
    });

    const response = await this.containerFetch(request);

    if (request.method === 'POST' && url.pathname === '/v1/jobs' && response.ok) {
      const idempotencyKey = String(request.headers.get('Idempotency-Key') || '').trim();
      if (idempotencyKey) {
        try {
          const body = (await response.clone().json()) as {
            jobId?: string;
            encoderJobId?: string;
            status?: string;
          };
          if (body.jobId && body.encoderJobId && body.status) {
            await this.ctx.storage.put(jobCacheKey(idempotencyKey), {
              status: body.status,
              encoderJobId: body.encoderJobId,
              jobId: body.jobId,
              updatedAt: new Date().toISOString(),
            });
          }
        } catch {
          // Non-fatal: container response may not be JSON on edge cases.
        }
      }
    }

    return response;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true, service: 'myso-video-encoder' });
    }

    if (request.method === 'POST' && url.pathname === '/v1/jobs') {
      let body: { jobId?: string };
      try {
        body = await request.clone().json();
      } catch {
        return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
      }

      const jobId = String(body.jobId || '').trim();
      if (!jobId) {
        return Response.json({ error: 'jobId required' }, { status: 400 });
      }

      const container = getContainer(env.VIDEO_ENCODER, encoderPoolName(jobId));
      return container.fetch(
        new Request('http://container/v1/jobs', {
          method: 'POST',
          headers: request.headers,
          body: await request.text(),
        }),
      );
    }

    return new Response('Not found', { status: 404 });
  },
};
