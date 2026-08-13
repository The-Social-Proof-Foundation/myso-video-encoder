import fs from 'fs';
import path from 'path';
import { getConfig } from '../config';
import { EncodeError } from '../types';

/** Local bundled logo, or download from WATERMARK_LOGO_URL when missing. */
export async function resolveWatermarkLogoPath(workDir: string): Promise<string> {
  const cfg = getConfig();
  if (cfg.watermarkLogoPath && fs.existsSync(cfg.watermarkLogoPath)) {
    return cfg.watermarkLogoPath;
  }

  if (cfg.watermarkLogoUrl) {
    const dest = path.join(workDir, 'logo-watermark.png');
    const res = await fetch(cfg.watermarkLogoUrl);
    if (!res.ok) {
      throw new EncodeError(
        'ENCODE_FAILED',
        `Failed to download watermark logo: HTTP ${res.status}`,
        true,
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    return dest;
  }

  throw new EncodeError(
    'VALIDATION_FAILED',
    `Watermark logo not found at ${cfg.watermarkLogoPath}`,
    false,
  );
}
