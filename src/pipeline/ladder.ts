import { LadderRung } from '../types';

export type Orientation = 'portrait' | 'landscape' | 'square';

export function orientationOf(width: number, height: number): Orientation {
  if (width === height) return 'square';
  return height > width ? 'portrait' : 'landscape';
}

/** Bounding boxes at 1080 / 720 / 540 / 360 for each orientation. */
export function boundingBoxes(orientation: Orientation): Array<{ name: string; boxW: number; boxH: number; crf: number; maxrate: string; bufsize: string }> {
  const rates = [
    { tier: '1080', crf: 20, maxrate: '5000k', bufsize: '10000k' },
    { tier: '720', crf: 21, maxrate: '2800k', bufsize: '5600k' },
    { tier: '540', crf: 22, maxrate: '1600k', bufsize: '3200k' },
    { tier: '360', crf: 23, maxrate: '900k', bufsize: '1800k' },
  ];

  return rates
    .map((r) => {
      const tier = Number(r.tier);
      if (orientation === 'portrait') {
        // 1080×1920, 720×1280, …
        return {
          name: r.tier,
          boxW: tier,
          boxH: Math.round((tier * 16) / 9),
          crf: r.crf,
          maxrate: r.maxrate,
          bufsize: r.bufsize,
        };
      }
      if (orientation === 'landscape') {
        // 1920×1080, 1280×720, …
        return {
          name: r.tier,
          boxW: Math.round((tier * 16) / 9),
          boxH: tier,
          crf: r.crf,
          maxrate: r.maxrate,
          bufsize: r.bufsize,
        };
      }
      return {
        name: r.tier,
        boxW: tier,
        boxH: tier,
        crf: r.crf,
        maxrate: r.maxrate,
        bufsize: r.bufsize,
      };
    })
    .map((b) => ({
      ...b,
      boxW: even(b.boxW),
      boxH: even(b.boxH),
    }));
}

export function even(n: number): number {
  const v = Math.max(2, Math.floor(n));
  return v % 2 === 0 ? v : v - 1;
}

/**
 * Fit source into box without upscale/pad. Returns null if box would require upscale.
 */
export function fitInBox(
  srcW: number,
  srcH: number,
  boxW: number,
  boxH: number,
): { width: number; height: number } | null {
  if (srcW <= 0 || srcH <= 0) return null;
  const scale = Math.min(boxW / srcW, boxH / srcH);
  if (scale > 1 + 1e-9) return null; // would upscale
  const width = even(srcW * scale);
  const height = even(srcH * scale);
  if (width < 2 || height < 2) return null;
  return { width, height };
}

export function buildLadder(srcW: number, srcH: number): LadderRung[] {
  const orientation = orientationOf(srcW, srcH);
  const boxes = boundingBoxes(orientation);
  const rungs: LadderRung[] = [];

  for (const box of boxes) {
    const fitted = fitInBox(srcW, srcH, box.boxW, box.boxH);
    if (!fitted) continue;
    rungs.push({
      name: box.name,
      width: fitted.width,
      height: fitted.height,
      crf: box.crf,
      maxrate: box.maxrate,
      bufsize: box.bufsize,
    });
  }

  if (rungs.length === 0) {
    // Even 360 would upscale → source-native only
    return [
      {
        name: 'source',
        width: even(srcW),
        height: even(srcH),
        crf: 21,
        maxrate: '2800k',
        bufsize: '5600k',
      },
    ];
  }

  return rungs;
}
