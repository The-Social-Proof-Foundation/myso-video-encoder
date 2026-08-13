import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildOverlayExpressions, escapeDrawtext } from './watermarkAnimation';

describe('watermarkAnimation', () => {
  it('builds fade cycle alpha expression', () => {
    const { alphaExpr } = buildOverlayExpressions();
    assert.match(alphaExpr, /mod\(t,5\)/);
    assert.match(alphaExpr, /if\(lt/);
  });

  it('cycles through six x/y anchors', () => {
    const { xExpr, yExpr } = buildOverlayExpressions();
    assert.match(xExpr, /mod\(floor\(t\/5\),6\)/);
    assert.match(yExpr, /H-h-/);
    assert.match(xExpr, /W-w-/);
  });

  it('escapes drawtext metacharacters', () => {
    assert.equal(escapeDrawtext('0xab:cd'), '0xab\\:cd');
  });
});
