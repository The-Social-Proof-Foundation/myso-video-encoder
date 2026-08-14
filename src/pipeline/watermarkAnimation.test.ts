import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildAlphaExpression,
  buildOverlayExpressions,
  DEFAULT_WATERMARK_TIMING,
  escapeDrawtext,
  escapeFilterExpr,
} from './watermarkAnimation';

describe('watermarkAnimation', () => {
  it('alpha is full at cycle start (no fade-in)', () => {
    const expr = buildAlphaExpression(DEFAULT_WATERMARK_TIMING, 't');
    assert.match(expr, /if\(lt\(mod\(t,5\),3\.9\),1,/);
    assert.doesNotMatch(expr, /mod\(t,5\)\/0\.4/);
  });

  it('alpha fades out then gaps (transition-only)', () => {
    const { alphaExpr, geqAlphaExpr } = buildOverlayExpressions();
    assert.match(alphaExpr, /mod\(t,5\)/);
    assert.match(geqAlphaExpr, /mod\(T,5\)/);
    assert.match(alphaExpr, /1-\(mod\(t,5\)-3\.9\)\/0\.4/);
  });

  it('starts at middle-right anchor', () => {
    const { xExpr, yExpr } = buildOverlayExpressions();
    assert.match(xExpr, /mod\(floor\(t\/5\),6\)/);
    assert.match(yExpr, /\(H-h\)\/2/);
    assert.match(xExpr, /W-w-/);
  });

  it('escapes drawtext metacharacters', () => {
    assert.equal(escapeDrawtext('0xab:cd'), '0xab\\:cd');
  });

  it('escapes commas in filter_complex expressions', () => {
    assert.equal(escapeFilterExpr('mod(t,5)'), 'mod(t\\,5)');
    assert.equal(escapeFilterExpr('if(lt(a,b),1,0)'), 'if(lt(a\\,b)\\,1\\,0)');
  });

  it('overlay expressions have no bare commas after escapeFilterExpr', () => {
    const { geqAlphaExpr, xExpr, yExpr } = buildOverlayExpressions();
    for (const escaped of [escapeFilterExpr(geqAlphaExpr), escapeFilterExpr(xExpr), escapeFilterExpr(yExpr)]) {
      assert.doesNotMatch(escaped, /(?<!\\),/);
    }
  });
});
