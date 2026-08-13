export const PROFILE = 'dripdrop-social-v1' as const;
export const EXPORT_PROFILE = 'dripdrop-export-v1' as const;

export interface WatermarkSpec {
  label: string;
}

export interface EncoderJobRequest {
  jobId: string;
  assetId: string;
  profile: string;
  sourceUrl: string;
  sourceExpiresAt: string;
  output: {
    bucket: string;
    prefix: string;
  };
  callbackUrl: string;
  watermark?: WatermarkSpec;
}

export type JobStatus = 'accepted' | 'running' | 'succeeded' | 'failed';

export interface StoredJob {
  encoderJobId: string;
  jobId: string;
  status: JobStatus;
  payloadHash: string;
  request: EncoderJobRequest;
  createdAt: string;
  updatedAt: string;
  errorCode?: string;
}

export interface EncoderCallbackRendition {
  name: string;
  playlistKey: string;
  initKey: string;
}

export interface EncoderSuccessCallback {
  eventId: string;
  jobId: string;
  encoderJobId: string;
  assetId: string;
  status: 'succeeded';
  hlsUrl: string;
  durationMs: number;
  width: number;
  height: number;
  renditions: EncoderCallbackRendition[];
  fallbackKey: string;
  posterKey: string;
  thumbnailKey: string;
}

export interface EncoderFailureCallback {
  eventId: string;
  jobId: string;
  encoderJobId: string;
  assetId: string;
  status: 'failed';
  errorCode: string;
  retryable: boolean;
}

export interface EncoderExportSuccessCallback {
  eventId: string;
  jobId: string;
  encoderJobId: string;
  assetId: string;
  status: 'succeeded';
  exportKey: string;
  durationMs: number;
  width: number;
  height: number;
}

export type EncoderExportFailureCallback = EncoderFailureCallback;

export class EncodeError extends Error {
  readonly errorCode: string;
  readonly retryable: boolean;

  constructor(errorCode: string, message: string, retryable = false) {
    super(message);
    this.name = 'EncodeError';
    this.errorCode = errorCode;
    this.retryable = retryable;
  }
}

export interface ProbeResult {
  durationSec: number;
  width: number;
  height: number;
  rotation: number;
  hasAudio: boolean;
  hasVideo: boolean;
  fps: number;
  isHdr: boolean;
  codecName?: string;
}

export interface LadderRung {
  name: string;
  /** Output width (even) */
  width: number;
  /** Output height (even) */
  height: number;
  crf: number;
  maxrate: string;
  bufsize: string;
}

export interface EncodedRendition {
  name: string;
  width: number;
  height: number;
  dir: string;
  playlistPath: string;
  initPath: string;
  segmentPaths: string[];
  averageBandwidth: number;
  peakBandwidth: number;
  codecs: string;
}
