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

/** Videos shorter than this get proportionally shorter fade + gap transitions. */
export const FULL_TRANSITION_MIN_SEC = 8;
/** Floor on the transition shrink so the fade never becomes a hard cut. */
export const MIN_TRANSITION_SCALE = 0.25;
/** The position after the first move stays on screen at least this long (or 40% of the video). */
export const MIN_VISIBLE_AFTER_MOVE_SEC = 1;
const MIN_HOLD_SEC = 0.05;

export type WatermarkPlan = {
  /** Timing to render with; fade/gap are shortened for short videos. */
  timing: WatermarkTiming;
  slots: WatermarkSlot[];
};

function round3(n: number): number {
  return Number(n.toFixed(3));
}

/**
 * Positions + holds for one export, guaranteed to move at least once whatever the length.
 * Long videos keep the 3–5s random holds. Short videos land the first move between ~35% and
 * 60% of the way in, so the second position stays visible for at least 40% of the video.
 * Consecutive positions always differ, a position never appears just to flash at the end, and
 * the last position holds at full opacity through the final frame.
 */
export function buildWatermarkPlan(params: {
  durationSec: number;
  timing?: WatermarkTiming;
  rng?: () => number;
}): WatermarkPlan {
  const base = params.timing ?? DEFAULT_WATERMARK_TIMING;
  const rng = params.rng ?? Math.random;
  const duration =
    Number.isFinite(params.durationSec) && params.durationSec > 0
      ? params.durationSec
      : 2 * (HOLD_MAX_SEC + base.fadeSec + base.gapSec);

  const transitionScale = Math.min(
    1,
    Math.max(MIN_TRANSITION_SCALE, duration / FULL_TRANSITION_MIN_SEC),
  );
  const timing: WatermarkTiming = {
    ...base,
    fadeSec: round3(base.fadeSec * transitionScale),
    gapSec: round3(base.gapSec * transitionScale),
  };
  const transition = timing.fadeSec + timing.gapSec;

  const visibleAfterMove = Math.max(
    Math.min(MIN_VISIBLE_AFTER_MOVE_SEC, duration / 2),
    duration * 0.4,
  );
  const latestFirstMove = duration - visibleAfterMove;
  const holdMax = Math.max(MIN_HOLD_SEC, Math.min(HOLD_MAX_SEC, latestFirstMove - transition));
  const holdMin = Math.min(HOLD_MIN_SEC, holdMax * 0.6);
  const pickHold = () => round3(holdMin + rng() * (holdMax - holdMin));
  // Below this much remaining time, extend the current position instead of flashing a new one.
  const minTail = Math.min(MIN_VISIBLE_AFTER_MOVE_SEC, duration / 4);

  const slots: WatermarkSlot[] = [];
  let covered = 0;
  while (covered < duration) {
    const prev = slots[slots.length - 1];
    if (prev && slots.length >= 2 && duration - covered < minTail) {
      prev.holdSec = round3(prev.holdSec + (duration - covered) + transition);
      break;
    }
    const pool = prev ? ALL_ANCHORS.filter((a) => a !== prev.anchor) : START_ANCHORS;
    slots.push({ anchor: pickFrom(pool, rng), holdSec: pickHold() });
    covered += slots[slots.length - 1].holdSec + transition;
  }
  if (slots.length === 1) {
    const prev = slots[0];
    slots.push({
      anchor: pickFrom(ALL_ANCHORS.filter((a) => a !== prev.anchor), rng),
      holdSec: pickHold(),
    });
  }
  // The last position stays fully visible through the final frame (no fade-out before the end).
  const last = slots[slots.length - 1];
  const lastStart = slots.slice(0, -1).reduce((t, s) => t + s.holdSec + transition, 0);
  last.holdSec = round3(Math.max(last.holdSec, duration - lastStart));
  return { timing, slots };
}

/** Slots for the given timing (see buildWatermarkPlan; ignores its fitted timing). */
export function buildWatermarkTimeline(params: {
  durationSec: number;
  timing?: WatermarkTiming;
  rng?: () => number;
}): WatermarkSlot[] {
  return buildWatermarkPlan(params).slots;
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
  const ranges = slots.map((slot, i) => {
    const start = cursor;
    const holdEnd = start + slot.holdSec;
    // Every position after the first eases in (the first is on screen from frame one).
    const fadeIn = i === 0 ? 0 : Math.min(fade, slot.holdSec / 2);
    const fadeEnd = holdEnd + fade;
    const slotEnd = fadeEnd + timing.gapSec;
    cursor = slotEnd;
    return { start, fadeIn, holdEnd, fadeEnd, slotEnd };
  });

  if (ranges.length === 0) return '0';

  let expr = '0';
  for (let i = ranges.length - 1; i >= 0; i -= 1) {
    const r = ranges[i];
    const fadeOutPart = `1-${easeExpr(timeVar, r.holdEnd, fade)}`;
    let inSlot =
      `if(lt(${timeVar},${fmtExprNum(r.holdEnd)}),1,` +
      `if(lt(${timeVar},${fmtExprNum(r.fadeEnd)}),${fadeOutPart},0))`;
    if (r.fadeIn > 0) {
      const inEnd = r.start + r.fadeIn;
      inSlot =
        `if(lt(${timeVar},${fmtExprNum(inEnd)}),${easeExpr(timeVar, r.start, r.fadeIn)},` +
        `${inSlot})`;
    }
    expr = `if(lt(${timeVar},${fmtExprNum(r.slotEnd)}),${inSlot},${expr})`;
  }
  return expr;
}

/** Smoothstep 0→1 over [from, from+dur]: u²(3−2u). Softer than a linear ramp at both ends. */
function easeExpr(timeVar: string, from: number, dur: number): string {
  const u = `(${timeVar}-${fmtExprNum(from)})/${fmtExprNum(dur)}`;
  return `(${u})*(${u})*(3-2*(${u}))`;
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
