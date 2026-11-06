import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  chooseEndCardVariant,
  computeEndCardLayout,
  END_CARD_BRIGHT_YAVG,
  END_CARD_CLIP,
  parseAverageYavg,
} from './endCardLayout';

function settledMarkBox(width: number, height: number) {
  const l = computeEndCardLayout(width, height);
  const sx = l.clipWidth / END_CARD_CLIP.width;
  const sy = l.clipHeight / END_CARD_CLIP.height;
  return {
    layout: l,
    left: l.clipX + END_CARD_CLIP.markLeft * sx,
    right: l.clipX + END_CARD_CLIP.markRight * sx,
    top: l.clipY + END_CARD_CLIP.markTop * sy,
    bottom: l.clipY + END_CARD_CLIP.markBottom * sy,
    motionBottom: l.clipY + END_CARD_CLIP.motionBottom * sy,
  };
}

describe('computeEndCardLayout', () => {
  for (const [w, h] of [
    [1080, 1920],
    [1920, 1080],
    [1080, 1080],
    [720, 1280],
  ]) {
    describe(`${w}x${h}`, () => {
      const box = settledMarkBox(w, h);

      it('settles the logo in the vertical middle of the frame', () => {
        const cy = (box.top + box.bottom) / 2;
        assert.ok(Math.abs(cy - h / 2) <= 2, `center y ${cy} vs ${h / 2}`);
      });

      it('centers the settled logo horizontally', () => {
        const cx = (box.left + box.right) / 2;
        assert.ok(Math.abs(cx - w / 2) <= 2, `center x ${cx} vs ${w / 2}`);
      });

      it('keeps the settled logo fully inside the frame', () => {
        assert.ok(box.left >= 0 && box.right <= w);
        assert.ok(box.top >= 0 && box.bottom <= h);
      });

      it('keeps the logo and its bounce above the username', () => {
        assert.ok(box.motionBottom < box.layout.usernameY);
        assert.ok(box.layout.usernameY + box.layout.usernameFontSize < box.layout.wordmarkY);
        assert.ok(box.layout.wordmarkY + box.layout.wordmarkHeight <= h);
      });

      it('keeps the settled logo at most a quarter of the frame width and height', () => {
        assert.ok(box.right - box.left <= w * 0.25 + 2, `logo width ${box.right - box.left} of ${w}`);
        assert.ok(box.bottom - box.top <= h * 0.27, `logo height ${box.bottom - box.top} of ${h}`);
      });

      it('scales the clip to even dimensions', () => {
        assert.equal(box.layout.clipWidth % 2, 0);
        assert.equal(box.layout.clipHeight % 2, 0);
      });
    });
  }

  it('sizes the wordmark prominently and tucks it under the username', () => {
    const l = computeEndCardLayout(1080, 1920);
    assert.ok(l.wordmarkHeight > l.usernameFontSize, `wordmark h ${l.wordmarkHeight}`);
    assert.ok(l.wordmarkWidth >= 1080 * 0.2, `wordmark width ${l.wordmarkWidth}`);
    assert.ok(l.wordmarkWidth <= 1080 * 0.36, `wordmark width ${l.wordmarkWidth}`);
    assert.equal(l.wordmarkWidth % 2, 0);
    assert.equal(l.wordmarkHeight % 2, 0);
    const gap = l.wordmarkY - (l.usernameY + l.usernameFontSize);
    assert.ok(gap > 0 && gap <= l.usernameFontSize * 0.4, `gap ${gap}`);
  });

  it('keeps the settled logo smaller than a fifth of the frame width', () => {
    const box = settledMarkBox(1080, 1920);
    assert.ok(box.right - box.left <= 1080 * 0.2, `logo width ${box.right - box.left}`);
  });

  it('shrinks the username font for long names so it fits the frame', () => {
    const short = computeEndCardLayout(1080, 1920, '@bob');
    const long = computeEndCardLayout(1080, 1920, '@' + 'w'.repeat(40));
    assert.equal(short.usernameFontSize, computeEndCardLayout(1080, 1920).usernameFontSize);
    assert.ok(long.usernameFontSize < short.usernameFontSize);
    assert.ok(long.usernameFontSize * 41 <= 1080, `font ${long.usernameFontSize}`);
  });
});

describe('parseAverageYavg', () => {
  it('averages YAVG lines from metadata print output', () => {
    const out =
      'frame:0    pts:0     pts_time:0\nlavfi.signalstats.YAVG=100.5\n' +
      'frame:1    pts:512   pts_time:0.033\nlavfi.signalstats.YAVG=200.5\n';
    assert.equal(parseAverageYavg(out), 150.5);
  });

  it('returns null without samples', () => {
    assert.equal(parseAverageYavg(''), null);
  });
});

describe('chooseEndCardVariant', () => {
  it('uses the black card after a bright ending', () => {
    assert.equal(chooseEndCardVariant(END_CARD_BRIGHT_YAVG), 'black');
    assert.equal(chooseEndCardVariant(220), 'black');
  });

  it('uses the white card after a dark ending', () => {
    assert.equal(chooseEndCardVariant(END_CARD_BRIGHT_YAVG - 0.1), 'white');
    assert.equal(chooseEndCardVariant(20), 'white');
  });

  it('falls back to the black card when brightness is unknown', () => {
    assert.equal(chooseEndCardVariant(null), 'black');
  });
});
