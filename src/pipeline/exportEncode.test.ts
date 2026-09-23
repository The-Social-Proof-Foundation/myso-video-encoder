import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildConcatListContents,
  buildEndCardFfmpegArgs,
  buildEndCardFilterComplex,
  buildStackedWatermarkFilterComplex,
  buildWatermarkedExportFilterComplex,
  buildWatermarkedExportFfmpegArgs,
  EXPORT_END_CARD_SEC,
  resolveWatermarkChimePath,
  WATERMARK_USERNAME_ROW_PX,
  WATERMARKED_EXPORT_FILENAME,
  watermarkedExportTempPath,
  watermarkFontSize,
} from './exportEncode';
import { EncodeError } from '../types';
import { resetConfigCache } from '../config';

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
  it('fades alpha only and composites in RGB/straight', () => {
    const filter = buildWatermarkedExportFilterComplex();
    assert.match(filter, /format=gbrp,fps=30\[base\]/);
    assert.match(filter, /geq=r='r\(X,Y\)':g='g\(X,Y\)':b='b\(X,Y\)':a='alpha\(X,Y\)\*\(/);
    assert.match(filter, /alpha=straight/);
    assert.match(filter, /format=gbrp:alpha=straight,format=yuv420p\[outv\]/);
    assert.doesNotMatch(filter, /alpha=premultiplied/);
    assert.doesNotMatch(filter, /geq=r='r\(X,Y\)\*\(/);
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

  it('includes fps filter, level 4.0, and silent AAC when no audio', () => {
    const args = buildWatermarkedExportFfmpegArgs({
      sourcePath: '/in/fallback.mp4',
      watermarkStripPath: '/in/wm.png',
      outPath: '/out/export-body.mp4',
      probe,
    });
    assert.ok(args.includes('-level'));
    assert.ok(args.includes('4.0'));
    assert.ok(args.includes('anullsrc=channel_layout=stereo:sample_rate=48000'));
    assert.ok(!args.includes('-an'));
    assert.ok(args.includes('-colorspace'));
    assert.ok(args.includes('bt709'));
    assert.ok(args.includes('2:a:0'));
    const outIdx = args.indexOf('/out/export-body.mp4');
    assert.ok(outIdx >= 0);
    assert.equal(args[outIdx - 2], '-f');
    assert.equal(args[outIdx - 1], 'mp4');
    assert.ok(args.includes('-t'));
    assert.ok(args.includes(String(probe.durationSec)));
  });

  it('maps source audio when present', () => {
    const args = buildWatermarkedExportFfmpegArgs({
      sourcePath: '/in/fallback.mp4',
      watermarkStripPath: '/in/wm.png',
      outPath: '/out/export-body.mp4',
      probe: { ...probe, hasAudio: true },
    });
    assert.ok(args.includes('-map'));
    assert.ok(args.includes('0:a:0?'));
    assert.ok(!args.includes('-an'));
    assert.ok(!args.includes('anullsrc=channel_layout=stereo:sample_rate=48000'));
  });

  it('uses v2 filename and .tmp path for atomic write', () => {
    assert.equal(WATERMARKED_EXPORT_FILENAME, 'watermarked-v2.mp4');
    assert.equal(
      watermarkedExportTempPath('/work/watermarked-v2.mp4'),
      '/work/watermarked-v2.mp4.tmp',
    );
  });
});

describe('end card', () => {
  const probe = {
    durationSec: 6.2,
    width: 720,
    height: 1280,
    rotation: 0,
    hasAudio: true,
    hasVideo: true,
    fps: 30,
    isHdr: false,
    codecName: 'h264',
  };

  it('centers straight-alpha overlay on black', () => {
    const filter = buildEndCardFilterComplex();
    assert.match(filter, /color=black|format=gbrp\[base\]/);
    assert.match(filter, /overlay=x=\(W-w\)\/2:y=\(H-h\)\/2/);
    assert.match(filter, /alpha=straight/);
    assert.match(filter, /format=yuv420p\[outv\]/);
  });

  it('plays chime for 2s with apad', () => {
    const args = buildEndCardFfmpegArgs({
      watermarkStripPath: '/in/wm.png',
      chimePath: '/in/dripdrop-chime.wav',
      outPath: '/out/export-card.mp4',
      probe,
    });
    assert.ok(args.some((a) => a.includes('color=c=black:s=720x1280')));
    assert.ok(args.includes('/in/dripdrop-chime.wav'));
    assert.ok(args.includes('apad'));
    assert.ok(args.includes(String(EXPORT_END_CARD_SEC)));
    assert.ok(args.includes('2:a:0'));
  });

  it('builds concat list for body then card', () => {
    const list = buildConcatListContents(['/tmp/body.mp4', '/tmp/card.mp4']);
    assert.equal(list, "file '/tmp/body.mp4'\nfile '/tmp/card.mp4'\n");
  });

  it('fails closed when chime is missing', () => {
    const prev = process.env.WATERMARK_CHIME_PATH;
    process.env.WATERMARK_CHIME_PATH = '/no/such/dripdrop-chime.wav';
    resetConfigCache();
    try {
      assert.throws(
        () => resolveWatermarkChimePath(),
        (err: unknown) => {
          assert.ok(err instanceof EncodeError);
          assert.match(String(err), /Watermark chime not found/);
          return true;
        },
      );
    } finally {
      if (prev == null) delete process.env.WATERMARK_CHIME_PATH;
      else process.env.WATERMARK_CHIME_PATH = prev;
      resetConfigCache();
    }
  });
});
