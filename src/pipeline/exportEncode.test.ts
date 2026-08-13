import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildStackedWatermarkFilterComplex,
  WATERMARK_USERNAME_ROW_PX,
} from './exportEncode';

describe('buildStackedWatermarkFilterComplex', () => {
  it('scales logo and draws username centered below', () => {
    const filter = buildStackedWatermarkFilterComplex({
      label: '@alice',
      logoWidth: 160,
    });
    assert.match(filter, /scale=160:-1\[logo\]/);
    assert.match(filter, /overlay=\(W-w\)\/2:0\[stacked\]/);
    assert.match(filter, /drawtext=text='@alice'/);
    assert.match(filter, /x=\(w-text_w\)\/2:y=h-28/);
    assert.doesNotMatch(filter, /DripDrop/);
  });

  it('escapes special characters in username label', () => {
    const filter = buildStackedWatermarkFilterComplex({
      label: '0x972237cc...a65e0f00',
      logoWidth: 160,
    });
    assert.match(filter, /drawtext=text='0x972237cc\.\.\.a65e0f00'/);
  });

  it('uses stacked canvas height from logo aspect + username row', () => {
    const filter = buildStackedWatermarkFilterComplex({
      label: '@bob',
      logoWidth: 160,
    });
    const expectedH = Math.ceil((160 * 360) / 500) + WATERMARK_USERNAME_ROW_PX;
    assert.match(filter, new RegExp(`s=200:${expectedH}`));
  });
});
