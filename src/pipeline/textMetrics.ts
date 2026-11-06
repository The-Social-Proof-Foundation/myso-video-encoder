/**
 * Rough rendered-width estimate for drawtext labels, so layouts can size canvases and fonts
 * before ffmpeg runs (drawtext cannot grow its canvas to fit the text).
 * Advance widths approximate Manrope Medium (the bundled font) in em units and lean slightly wide,
 * so a label sized with this estimate fits rather than clips.
 */

const NARROW = new Set("iljI.,:;'!|`".split(''));
const WIDE = new Set('mwMW@%'.split(''));

function charEm(ch: string): number {
  if (NARROW.has(ch)) return 0.34;
  if (WIDE.has(ch)) return 1.0;
  if (ch === ' ') return 0.34;
  if (ch === '_' || ch === '-') return 0.52;
  if (ch === 'f' || ch === 't' || ch === 'r') return 0.44;
  if (/[0-9]/.test(ch)) return 0.66;
  if (/[A-Z]/.test(ch)) return 0.76;
  if (/[a-z]/.test(ch)) return 0.64;
  if (ch.charCodeAt(0) < 128) return 0.66;
  // CJK, emoji, and other non-ASCII glyphs are usually full width.
  return 1.05;
}

export function estimateTextWidthPx(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of Array.from(text)) em += charEm(ch);
  return Math.ceil(em * fontSize);
}

/** Largest font size (≤ preferred, ≥ min) whose estimated width fits within maxWidth. */
export function fitFontSize(
  text: string,
  preferred: number,
  maxWidth: number,
  min = 10,
): number {
  const width = estimateTextWidthPx(text, preferred);
  if (width <= maxWidth || width === 0) return preferred;
  return Math.max(min, Math.floor((preferred * maxWidth) / width));
}
