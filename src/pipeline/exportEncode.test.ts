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
  resolveEndCardClipPath,
  WATERMARK_USERNAME_ROW_PX,
  WATERMARKED_EXPORT_FILENAME,
  watermarkedExportTempPath,
  watermarkFontSize,
} from './exportEncode';
import { computeEndCardLayout } from './endCardLayout';
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

  const layout = computeEndCardLayout(probe.width, probe.height);

  function cardFilter(variant: 'black' | 'white' = 'black', label = '@alice') {
    return buildEndCardFilterComplex({
      variant,
      layout,
      label,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
    });
  }

  it('lasts 2.5s', () => {
    assert.equal(EXPORT_END_CARD_SEC, 2.5);
  });

  it('plays the clip once then holds its last frame', () => {
    const filter = cardFilter();
    assert.match(filter, /\[0:v\]fps=30,format=gbrp,tpad=stop_mode=clone:stop_duration=2\.5/);
  });

  it('stretches the clip corner into a full-frame background', () => {
    const filter = cardFilter();
    assert.match(filter, /\[corner\]crop=8:8:0:0,scale=720:1280:flags=neighbor\[base\]/);
  });

  it('scales and places the clip from the layout', () => {
    const filter = cardFilter();
    assert.match(filter, new RegExp(`scale=${layout.clipWidth}:${layout.clipHeight}:flags=lanczos`));
    assert.match(filter, new RegExp(`overlay=x=${layout.clipX}:y=${layout.clipY}:format=gbrp`));
    assert.match(filter, /format=yuv420p\[outv\]/);
  });

  it('draws username then dripdrop.social centered at the bottom', () => {
    const filter = cardFilter('black', 'brandon:shaw');
    assert.match(
      filter,
      new RegExp(
        `drawtext=text='brandon\\\\:shaw':fontcolor=0xFFFFFF:fontsize=${layout.usernameFontSize}:` +
          `x=\\(w-text_w\\)/2:y=${layout.usernameY}`,
      ),
    );
    assert.match(
      filter,
      new RegExp(
        `drawtext=text='dripdrop\\.social':fontcolor=0xA3A3A3:fontsize=${layout.urlFontSize}:` +
          `x=\\(w-text_w\\)/2:y=${layout.urlY}`,
      ),
    );
  });

  it('uses dark text on the white card', () => {
    const filter = cardFilter('white');
    assert.match(filter, /fontcolor=0x111111/);
    assert.match(filter, /fontcolor=0x737373/);
  });

  it('pads the clip audio to the card length', () => {
    assert.match(
      cardFilter(),
      /\[0:a:0\]aformat=sample_rates=48000:channel_layouts=stereo,apad\[outa\]/,
    );
  });

  it('encodes the clip with mapped video and audio for 2.5s', () => {
    const args = buildEndCardFfmpegArgs({
      clipPath: '/in/endcard-black.mp4',
      variant: 'black',
      label: '@alice',
      outPath: '/out/export-card.mp4',
      probe,
    });
    assert.equal(args[args.indexOf('-i') + 1], '/in/endcard-black.mp4');
    assert.equal(args.filter((a) => a === '-i').length, 1);
    assert.equal(args[args.indexOf('-t') + 1], String(EXPORT_END_CARD_SEC));
    assert.ok(args.includes('[outv]'));
    assert.ok(args.includes('[outa]'));
    assert.equal(args[args.length - 1], '/out/export-card.mp4');
  });

  it('builds concat list for body then card', () => {
    const list = buildConcatListContents(['/tmp/body.mp4', '/tmp/card.mp4']);
    assert.equal(list, "file '/tmp/body.mp4'\nfile '/tmp/card.mp4'\n");
  });

  it('fails closed when the end card clip is missing', () => {
    const prev = process.env.ENDCARD_WHITE_PATH;
    process.env.ENDCARD_WHITE_PATH = '/no/such/endcard-white.mp4';
    resetConfigCache();
    try {
      assert.throws(
        () => resolveEndCardClipPath('white'),
        (err: unknown) => {
          assert.ok(err instanceof EncodeError);
          assert.match(String(err), /End card clip \(white\) not found/);
          return true;
        },
      );
    } finally {
      if (prev == null) delete process.env.ENDCARD_WHITE_PATH;
      else process.env.ENDCARD_WHITE_PATH = prev;
      resetConfigCache();
    }
  });
});
