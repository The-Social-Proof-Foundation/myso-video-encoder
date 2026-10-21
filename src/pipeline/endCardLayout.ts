/**
 * Export end card: animated logo clip placed top-middle, creator + site text at the bottom.
 * Pure layout and variant selection so the ffmpeg graph stays testable.
 */
import { even } from './ladder';

/** Background color of the end card; the logo is the opposite color. */
export type EndCardVariant = 'black' | 'white';

export const END_CARD_USERNAME_COLOR: Record<EndCardVariant, string> = {
  black: '0xFFFFFF',
  white: '0x111111',
};

export const END_CARD_URL_COLOR: Record<EndCardVariant, string> = {
  black: '0xA3A3A3',
  white: '0x737373',
};

export const END_CARD_URL_TEXT = 'dripdrop.social';

/**
 * Geometry of the bundled 698×1440 clips (both variants share it).
 * The settled logo occupies markLeft..markRight × markTop..markBottom; the bounce
 * mid-animation dips to motionBottom.
 */
export const END_CARD_CLIP = {
  width: 698,
  height: 1440,
  markLeft: 34,
  markTop: 526,
  markRight: 666,
  markBottom: 1158,
  motionBottom: 1402,
} as const;

/** Settled-logo center as a fraction of frame height (upper third, eye line). */
export const END_CARD_LOGO_CENTER_Y = 0.3;
/** Settled-logo width cap as a fraction of frame width. */
export const END_CARD_LOGO_MAX_WIDTH = 0.5;

export const END_CARD_BRIGHT_YAVG = 128;

export interface EndCardLayout {
  clipWidth: number;
  clipHeight: number;
  clipX: number;
  clipY: number;
  usernameFontSize: number;
  urlFontSize: number;
  usernameY: number;
  urlY: number;
}

export function computeEndCardLayout(width: number, height: number): EndCardLayout {
  const base = Math.min(width, height);
  const usernameFontSize = Math.max(12, Math.round(base * 0.044));
  const urlFontSize = Math.max(10, Math.round(base * 0.032));
  const bottomPad = Math.round(height * 0.05);
  const lineGap = Math.round(urlFontSize * 0.5);
  const urlY = height - bottomPad - urlFontSize;
  const usernameY = urlY - lineGap - usernameFontSize;

  const topPad = Math.round(height * 0.04);
  const textGap = Math.round(height * 0.03);
  const centerY = height * END_CARD_LOGO_CENTER_Y;

  const c = END_CARD_CLIP;
  const markW = c.markRight - c.markLeft;
  const markCx = (c.markLeft + c.markRight) / 2;
  const markCy = (c.markTop + c.markBottom) / 2;

  const scale = Math.min(
    (width * END_CARD_LOGO_MAX_WIDTH) / markW,
    (centerY - topPad) / (markCy - c.markTop),
    (usernameY - textGap - centerY) / (c.motionBottom - markCy),
  );

  const clipWidth = even(c.width * scale);
  const clipHeight = even(c.height * scale);
  const sx = clipWidth / c.width;
  const sy = clipHeight / c.height;

  return {
    clipWidth,
    clipHeight,
    clipX: Math.round(width / 2 - markCx * sx),
    clipY: Math.round(centerY - markCy * sy),
    usernameFontSize,
    urlFontSize,
    usernameY,
    urlY,
  };
}

/** Average `lavfi.signalstats.YAVG` values from ffmpeg metadata print output; null when absent. */
export function parseAverageYavg(output: string): number | null {
  const values: number[] = [];
  for (const match of output.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)) {
    const n = Number(match[1]);
    if (Number.isFinite(n)) values.push(n);
  }
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Bright endings cut to the black card, dark endings to the white card. Unknown → black. */
export function chooseEndCardVariant(yavg: number | null): EndCardVariant {
  if (yavg == null) return 'black';
  return yavg >= END_CARD_BRIGHT_YAVG ? 'black' : 'white';
}
