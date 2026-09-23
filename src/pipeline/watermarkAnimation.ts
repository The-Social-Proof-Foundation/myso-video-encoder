/**
 * FFmpeg overlay expressions for watermark animation with fade + gap.
 * Positions and holds are baked in Node so the overlay does not flicker.
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
  holdSec: 3.9,
  gapSec: 0.7,
  paddingPx: 24,
};

export type WatermarkAnchor =
  | 'middle_right'
  | 'middle_left'
  | 'top_right'
  | 'bottom_right'
  | 'bottom_left'
  | 'top_left'
  | 'bottom_center';

export const START_ANCHORS: WatermarkAnchor[] = ['middle_right', 'middle_left'];

export const ALL_ANCHORS: WatermarkAnchor[] = [
  'middle_right',
  'middle_left',
  'top_right',
  'bottom_right',
  'bottom_left',
  'top_left',
  'bottom_center',
];

export const HOLD_MIN_SEC = 3;
export const HOLD_MAX_SEC = 5;

export type WatermarkSlot = {
  anchor: WatermarkAnchor;
  holdSec: number;
};

export function fmtExprNum(n: number): string {
  return String(Number(n.toFixed(3)));
}

function pickFrom<T>(items: readonly T[], rng: () => number): T {
  const idx = Math.min(items.length - 1, Math.floor(rng() * items.length));
  return items[idx];
}

export function pickRandomHold(rng: () => number = Math.random): number {
  return Number((HOLD_MIN_SEC + rng() * (HOLD_MAX_SEC - HOLD_MIN_SEC)).toFixed(3));
}

/** Enough slots to cover duration (worst-case hold = HOLD_MIN_SEC). */
export function buildWatermarkTimeline(params: {
  durationSec: number;
  timing?: WatermarkTiming;
  rng?: () => number;
}): WatermarkSlot[] {
  const timing = params.timing ?? DEFAULT_WATERMARK_TIMING;
  const rng = params.rng ?? Math.random;
  const slots: WatermarkSlot[] = [];
  let covered = 0;
  const target = Math.max(params.durationSec, timing.fadeSec + timing.gapSec + HOLD_MIN_SEC);
  while (covered < target) {
    const isFirst = slots.length === 0;
    slots.push({
      anchor: pickFrom(isFirst ? START_ANCHORS : ALL_ANCHORS, rng),
      holdSec: pickRandomHold(rng),
    });
    const last = slots[slots.length - 1];
    covered += last.holdSec + timing.fadeSec + timing.gapSec;
  }
  return slots;
}

export function slotDurationSec(slot: WatermarkSlot, timing: WatermarkTiming): number {
  return slot.holdSec + timing.fadeSec + timing.gapSec;
}

export function slotEnds(slots: WatermarkSlot[], timing: WatermarkTiming): number[] {
  const ends: number[] = [];
  let t = 0;
  for (const slot of slots) {
    t += slotDurationSec(slot, timing);
    ends.push(t);
  }
  return ends;
}

/** Hold at full opacity, fade-out transition, gap — no fade-in at cycle start. */
export function buildAlphaExpression(
  t: WatermarkTiming,
  /** overlay/filter uses `t`; geq uses `T` for timestamp. */
  timeVar: 't' | 'T' = 't',
): string {
  const { cycleSec, fadeSec, holdSec } = t;
  const fadeOutStart = holdSec;
  const fadeOutEnd = holdSec + fadeSec;
  const p = `mod(${timeVar},${cycleSec})`;
  return (
    `if(lt(${p},${fadeOutStart}),1,` +
    `if(lt(${p},${fadeOutEnd}),1-(${p}-${fadeOutStart})/${fadeSec},0))`
  );
}

export function anchorCoord(anchor: WatermarkAnchor, axis: 'x' | 'y', padding: number): string {
  const p = String(padding);
  switch (anchor) {
    case 'middle_right':
      return axis === 'x' ? `W-w-${p}` : `(H-h)/2`;
    case 'middle_left':
      return axis === 'x' ? p : `(H-h)/2`;
    case 'top_right':
      return axis === 'x' ? `W-w-${p}` : p;
    case 'bottom_right':
      return axis === 'x' ? `W-w-${p}` : `H-h-${p}`;
    case 'bottom_left':
      return axis === 'x' ? p : `H-h-${p}`;
    case 'top_left':
      return axis === 'x' ? p : p;
    case 'bottom_center':
      return axis === 'x' ? `(W-w)/2` : `H-h-${p}`;
    default:
      return p;
  }
}

export function buildTimelineAlphaExpression(
  slots: WatermarkSlot[],
  timing: WatermarkTiming,
  timeVar: 't' | 'T' = 't',
): string {
  const fade = timing.fadeSec;
  let cursor = 0;
  const ranges = slots.map((slot) => {
    const start = cursor;
    const holdEnd = start + slot.holdSec;
    const fadeEnd = holdEnd + fade;
    const slotEnd = fadeEnd + timing.gapSec;
    cursor = slotEnd;
    return { holdEnd, fadeEnd, slotEnd };
  });

  if (ranges.length === 0) return '0';

  let expr = '0';
  for (let i = ranges.length - 1; i >= 0; i -= 1) {
    const r = ranges[i];
    const fadePart = `1-(${timeVar}-${fmtExprNum(r.holdEnd)})/${fmtExprNum(fade)}`;
    const inSlot =
      `if(lt(${timeVar},${fmtExprNum(r.holdEnd)}),1,` +
      `if(lt(${timeVar},${fmtExprNum(r.fadeEnd)}),${fadePart},0))`;
    expr = `if(lt(${timeVar},${fmtExprNum(r.slotEnd)}),${inSlot},${expr})`;
  }
  return expr;
}

function buildTimelineAxisExpression(
  slots: WatermarkSlot[],
  axis: 'x' | 'y',
  timing: WatermarkTiming,
  timeVar: 't' | 'T' = 't',
): string {
  const ends = slotEnds(slots, timing);
  if (slots.length === 0) return anchorCoord('middle_right', axis, timing.paddingPx);
  let expr = anchorCoord(slots[slots.length - 1].anchor, axis, timing.paddingPx);
  for (let i = slots.length - 2; i >= 0; i -= 1) {
    expr = `if(lt(${timeVar},${fmtExprNum(ends[i])}),${anchorCoord(slots[i].anchor, axis, timing.paddingPx)},${expr})`;
  }
  return expr;
}

export function buildOverlayExpressions(
  t: WatermarkTiming = DEFAULT_WATERMARK_TIMING,
  timeline?: WatermarkSlot[],
): {
  /** For overlay/colorchannelmixer-style filters (timestamp `t`). */
  alphaExpr: string;
  /** For geq alpha channel (timestamp `T`). */
  geqAlphaExpr: string;
  xExpr: string;
  yExpr: string;
} {
  const slots =
    timeline && timeline.length > 0
      ? timeline
      : buildWatermarkTimeline({ durationSec: 180, timing: t, rng: () => 0 });
  return {
    alphaExpr: buildTimelineAlphaExpression(slots, t, 't'),
    geqAlphaExpr: buildTimelineAlphaExpression(slots, t, 'T'),
    xExpr: buildTimelineAxisExpression(slots, 'x', t, 't'),
    yExpr: buildTimelineAxisExpression(slots, 'y', t, 't'),
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

/** Escape commas so filter_complex option values are not split. */
export function escapeFilterExpr(expr: string): string {
  return expr.replace(/,/g, '\\,');
}
