import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildStackedWatermarkFilterComplex,
  buildWatermarkedExportFilterComplex,
  buildWatermarkedExportFfmpegArgs,
  watermarkedExportTempPath,
  watermarkFontSize,
  WATERMARK_USERNAME_ROW_PX,
} from './exportEncode';

describe('buildStackedWatermarkFilterComplex', () => {
  it('preserves alpha with format=rgba and lanczos scale', () => {
    const filter = buildStackedWatermarkFilterComplex({
      label: '@alice',
      logoWidth: 220,
    });
    assert.match(filter, /format=rgba,scale=220:-1:flags=lanczos/);
    assert.match(filter, /pad=w=iw:h=ih\+/);
    assert.match(filter, /color=0x00000000/);
    assert.match(filter, /box=0/);
    assert.doesNotMatch(filter, /color=c=black@0\.0/);
  });

  it('draws username centered below logo with scaled fontsize', () => {
    const filter = buildStackedWatermarkFilterComplex({
      label: '@alice',
      logoWidth: 220,
    });
    assert.match(filter, /drawtext=text='@alice'/);
    assert.match(filter, /x=\(w-text_w\)\/2:y=h-28/);
    assert.match(filter, new RegExp(`fontsize=${watermarkFontSize(220)}`));
    assert.doesNotMatch(filter, /DripDrop/);
  });

  it('escapes special characters in username label', () => {
    const filter = buildStackedWatermarkFilterComplex({
      label: '0x972237cc...a65e0f00',
      logoWidth: 160,
    });
    assert.match(filter, /drawtext=text='0x972237cc\.\.\.a65e0f00'/);
  });

  it('pads transparent row below logo for username', () => {
    const filter = buildStackedWatermarkFilterComplex({
      label: '@bob',
      logoWidth: 160,
      usernameRowPx: WATERMARK_USERNAME_ROW_PX,
    });
    assert.match(filter, new RegExp(`h=ih\\+${WATERMARK_USERNAME_ROW_PX}`));
  });
});

describe('buildWatermarkedExportFilterComplex', () => {
  it('premultiplies RGB and alpha with fade factor', () => {
    const filter = buildWatermarkedExportFilterComplex();
    assert.match(filter, /geq=r='r\(X,Y\)\*\(/);
    assert.match(filter, /g='g\(X,Y\)\*\(/);
    assert.match(filter, /b='b\(X,Y\)\*\(/);
    assert.match(filter, /alpha=premultiplied/);
  });
});

describe('buildWatermarkedExportFfmpegArgs', () => {
  const probe = {
    durationSec: 6.2,
    width: 720,
    height: 1280,
    rotation: 0,
    hasAudio: false,
    hasVideo: true,
    fps: 30,
    isHdr: false,
    codecName: 'h264',
  };

  it('includes fps filter, level 4.0, and -an when no audio', () => {
    const filter = buildWatermarkedExportFilterComplex();
    assert.match(filter, /fps=30\[base\]/);

    const args = buildWatermarkedExportFfmpegArgs({
      sourcePath: '/in/fallback.mp4',
      watermarkStripPath: '/in/wm.png',
      outPath: '/out/watermarked.mp4.tmp',
      probe,
    });
    assert.ok(args.includes('-level'));
    assert.ok(args.includes('4.0'));
    assert.ok(args.includes('-an'));
    assert.ok(args.includes('-colorspace'));
    assert.ok(args.includes('bt709'));
    assert.doesNotMatch(args.join(' '), /-map.*0:a/);
    const outIdx = args.indexOf('/out/watermarked.mp4.tmp');
    assert.ok(outIdx >= 0);
    assert.equal(args[outIdx - 2], '-f');
    assert.equal(args[outIdx - 1], 'mp4');
    assert.ok(args.includes('-t'));
    assert.ok(args.includes(String(probe.durationSec)));
  });

  it('maps audio when source has audio', () => {
    const args = buildWatermarkedExportFfmpegArgs({
      sourcePath: '/in/fallback.mp4',
      watermarkStripPath: '/in/wm.png',
      outPath: '/out/watermarked.mp4.tmp',
      probe: { ...probe, hasAudio: true },
    });
    assert.ok(args.includes('-map'));
    assert.ok(args.includes('0:a:0?'));
    assert.ok(!args.includes('-an'));
  });

  it('uses .tmp path for atomic write', () => {
    assert.equal(watermarkedExportTempPath('/work/watermarked.mp4'), '/work/watermarked.mp4.tmp');
  });
});
