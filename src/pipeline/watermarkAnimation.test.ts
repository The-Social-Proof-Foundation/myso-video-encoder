import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ALL_ANCHORS,
  buildAlphaExpression,
  buildOverlayExpressions,
  buildTimelineAlphaExpression,
  buildWatermarkPlan,
  buildWatermarkTimeline,
  DEFAULT_WATERMARK_TIMING,
  escapeDrawtext,
  escapeFilterExpr,
  HOLD_MAX_SEC,
  HOLD_MIN_SEC,
  pickRandomHold,
  slotEnds,
  START_ANCHORS,
  WatermarkSlot,
} from './watermarkAnimation';

function scriptedRng(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
}

describe('watermarkAnimation', () => {
  it('alpha is full at cycle start (no fade-in)', () => {
    const expr = buildAlphaExpression(DEFAULT_WATERMARK_TIMING, 't');
    assert.match(expr, /if\(lt\(mod\(t,5\),3\.9\),1,/);
    assert.doesNotMatch(expr, /mod\(t,5\)\/0\.4/);
  });

  it('starts at mid-left or mid-right then uses baked holds', () => {
    const timeline: WatermarkSlot[] = [
      { anchor: 'middle_left', holdSec: 3.2 },
      { anchor: 'top_right', holdSec: 4.5 },
    ];
    const { xExpr, yExpr, alphaExpr, geqAlphaExpr } = buildOverlayExpressions(
      DEFAULT_WATERMARK_TIMING,
      timeline,
    );
    assert.match(xExpr, /if\(lt\(t,4\.3\)/);
    assert.match(yExpr, /\(H-h\)\/2/);
    assert.match(xExpr, /W-w-/);
    assert.match(alphaExpr, /if\(lt\(t,3\.2\),1,/);
    assert.match(geqAlphaExpr, /if\(lt\(T,3\.2\),1,/);
    assert.doesNotMatch(xExpr, /mod\(floor\(t/);
  });

  it('seeded timeline first slot is only a start anchor', () => {
    const leftFirst = buildWatermarkTimeline({
      durationSec: 12,
      rng: scriptedRng([0.9, 0.25, 0.1, 0.5, 0.2, 0.8]),
    });
    assert.ok(START_ANCHORS.includes(leftFirst[0].anchor));
    assert.equal(leftFirst[0].anchor, 'middle_left');
    assert.ok(ALL_ANCHORS.includes(leftFirst[1].anchor));
    // The final slot may be stretched to the end instead of flashing a new position.
    for (const slot of leftFirst.slice(0, -1)) {
      assert.ok(slot.holdSec >= HOLD_MIN_SEC && slot.holdSec <= HOLD_MAX_SEC);
    }
  });

  it('seeded timeline can start middle-right', () => {
    const rightFirst = buildWatermarkTimeline({
      durationSec: 8,
      rng: scriptedRng([0, 0, 0.4, 0.4]),
    });
    assert.equal(rightFirst[0].anchor, 'middle_right');
  });

  describe('moves at least once at any length', () => {
    for (const durationSec of [0.8, 1.5, 3, 5, 6, 8, 12, 30, 95]) {
      it(`${durationSec}s video`, () => {
        for (let seed = 0; seed < 50; seed += 1) {
          let x = seed * 9301 + 49297;
          const rng = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
          const { timing, slots } = buildWatermarkPlan({ durationSec, rng });
          assert.ok(slots.length >= 2);
          const ends = slotEnds(slots, timing);
          // Second position appears before the end and stays a meaningful share of the video.
          const visibleAfter = durationSec - ends[0];
          assert.ok(
            visibleAfter >= Math.min(1, durationSec / 2) - 1e-6 && visibleAfter >= durationSec * 0.4 - 1e-6,
            `first move at ${ends[0]} of ${durationSec}`,
          );
          for (let i = 1; i < slots.length; i += 1) {
            assert.notEqual(slots[i].anchor, slots[i - 1].anchor);
          }
          assert.ok(START_ANCHORS.includes(slots[0].anchor));
          // Final position is still fully visible on the last frame.
          const lastHoldEnd = ends[ends.length - 1] - timing.fadeSec - timing.gapSec;
          assert.ok(lastHoldEnd >= durationSec - 1e-3, `last hold ends ${lastHoldEnd} of ${durationSec}`);
          // Every position that starts before the end is on screen for a visible stretch.
          for (let i = 1; i < slots.length; i += 1) {
            if (ends[i - 1] < durationSec) {
              assert.ok(durationSec - ends[i - 1] >= Math.min(1, durationSec / 4) - 1e-6);
            }
          }
        }
      });
    }

    it('keeps 3–5s holds and full transitions on long videos', () => {
      const { timing, slots } = buildWatermarkPlan({ durationSec: 60, rng: () => 0.5 });
      assert.deepEqual(timing, DEFAULT_WATERMARK_TIMING);
      for (const slot of slots.slice(0, -1)) {
        assert.ok(slot.holdSec >= HOLD_MIN_SEC && slot.holdSec <= HOLD_MAX_SEC);
      }
    });

    it('shortens fades on short videos', () => {
      const { timing } = buildWatermarkPlan({ durationSec: 5, rng: () => 0.5 });
      assert.ok(timing.fadeSec < DEFAULT_WATERMARK_TIMING.fadeSec);
      assert.ok(timing.gapSec < DEFAULT_WATERMARK_TIMING.gapSec);
    });
  });

  it('pickRandomHold stays in 3–5', () => {
    assert.equal(pickRandomHold(() => 0), HOLD_MIN_SEC);
    assert.equal(pickRandomHold(() => 1), HOLD_MAX_SEC);
    assert.ok(pickRandomHold(() => 0.5) > HOLD_MIN_SEC);
  });

  it('timeline alpha includes hold cutovers', () => {
    const slots: WatermarkSlot[] = [
      { anchor: 'middle_right', holdSec: 3 },
      { anchor: 'bottom_left', holdSec: 5 },
    ];
    const expr = buildTimelineAlphaExpression(slots, DEFAULT_WATERMARK_TIMING, 't');
    assert.match(expr, /if\(lt\(t,3\),1,/);
    assert.match(expr, /if\(lt\(t,9\.1\),1,/);
    const ends = slotEnds(slots, DEFAULT_WATERMARK_TIMING);
    assert.equal(ends[0], 4.1);
    assert.equal(Number(ends[1].toFixed(3)), 10.2);
  });

  it('escapes drawtext metacharacters', () => {
    assert.equal(escapeDrawtext('0xab:cd'), '0xab\\:cd');
  });

  it('escapes commas in filter_complex expressions', () => {
    assert.equal(escapeFilterExpr('mod(t,5)'), 'mod(t\\,5)');
    assert.equal(escapeFilterExpr('if(lt(a,b),1,0)'), 'if(lt(a\\,b)\\,1\\,0)');
  });

  it('overlay expressions have no bare commas after escapeFilterExpr', () => {
    const timeline: WatermarkSlot[] = [{ anchor: 'middle_right', holdSec: 4 }];
    const { geqAlphaExpr, xExpr, yExpr } = buildOverlayExpressions(
      DEFAULT_WATERMARK_TIMING,
      timeline,
    );
    for (const escaped of [
      escapeFilterExpr(geqAlphaExpr),
      escapeFilterExpr(xExpr),
      escapeFilterExpr(yExpr),
    ]) {
      assert.doesNotMatch(escaped, /(?<!\\),/);
    }
  });
});
