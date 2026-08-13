/**
 * FFmpeg overlay expressions for 6-position watermark animation with fade + gap.
 */

export type WatermarkTiming = {
  cycleSec: number;
  fadeSec: number;
  holdSec: number;
  gapSec: number;
  paddingPx: number;
};

export const DEFAULT_WATERMARK_TIMING: WatermarkTiming = {
  cycleSec: 5,
  fadeSec: 0.4,
  holdSec: 3.5,
  gapSec: 0.7,
  paddingPx: 24,
};

/** Alpha 0→1→0 with invisible gap between position cycles. */
export function buildAlphaExpression(t: WatermarkTiming): string {
  const { cycleSec, fadeSec, holdSec, gapSec } = t;
  const fadeEnd = fadeSec;
  const holdEnd = fadeSec + holdSec;
  const fadeOutEnd = fadeEnd + holdSec + fadeSec;
  // phase within cycle
  const p = `mod(t,${cycleSec})`;
  return (
    `if(lt(${p},${fadeEnd}),${p}/${fadeSec},` +
    `if(lt(${p},${holdEnd}),1,` +
    `if(lt(${p},${fadeOutEnd}),1-(${p}-${holdEnd})/${fadeSec},0)))`
  );
}

function anchorCoord(index: number, axis: 'x' | 'y', padding: number): string {
  const p = String(padding);
  switch (index) {
    case 0:
      return axis === 'x' ? p : p;
    case 1:
      return axis === 'x' ? `W-w-${p}` : p;
    case 2:
      return axis === 'x' ? p : `H-h-${p}`;
    case 3:
      return axis === 'x' ? `W-w-${p}` : `H-h-${p}`;
    case 4:
      return axis === 'x' ? `(W-w)/2` : p;
    case 5:
      return axis === 'x' ? `(W-w)/2` : `H-h-${p}`;
    default:
      return p;
  }
}

function buildAxisExpression(axis: 'x' | 'y', t: WatermarkTiming): string {
  const idx = `mod(floor(t/${t.cycleSec}),6)`;
  let expr = anchorCoord(5, axis, t.paddingPx);
  for (let i = 4; i >= 0; i -= 1) {
    expr = `if(eq(${idx},${i}),${anchorCoord(i, axis, t.paddingPx)},${expr})`;
  }
  return expr;
}

export function buildOverlayExpressions(t: WatermarkTiming = DEFAULT_WATERMARK_TIMING): {
  alphaExpr: string;
  xExpr: string;
  yExpr: string;
} {
  return {
    alphaExpr: buildAlphaExpression(t),
    xExpr: buildAxisExpression('x', t),
    yExpr: buildAxisExpression('y', t),
  };
}

/** Escape text for FFmpeg drawtext (single-quoted). */
export function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%');
}
