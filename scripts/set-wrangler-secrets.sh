#!/usr/bin/env bash
# Set Cloudflare Worker secrets for the video encoder container.
# Run from repo root after: npx wrangler login
#
# Usage:
#   source .env && ./scripts/set-wrangler-secrets.sh
#
# Required in environment or .env:
#   R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
#   ENCODER_CALLBACK_HMAC_KEYS, VIDEO_MEDIA_HOST

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

require() {
  if [[ -z "${!1:-}" ]]; then
    echo "Missing required env var: $1" >&2
    exit 1
  fi
}

require R2_ENDPOINT
require R2_ACCESS_KEY_ID
require R2_SECRET_ACCESS_KEY
require ENCODER_CALLBACK_HMAC_KEYS
require VIDEO_MEDIA_HOST

put_secret() {
  local name="$1"
  local value="$2"
  printf '%s' "$value" | npx wrangler secret put "$name"
  echo "Set secret: $name"
}

put_secret R2_ENDPOINT "$R2_ENDPOINT"
put_secret R2_ACCESS_KEY_ID "$R2_ACCESS_KEY_ID"
put_secret R2_SECRET_ACCESS_KEY "$R2_SECRET_ACCESS_KEY"
put_secret ENCODER_CALLBACK_HMAC_KEYS "$ENCODER_CALLBACK_HMAC_KEYS"
put_secret VIDEO_MEDIA_HOST "$VIDEO_MEDIA_HOST"

if [[ -n "${ENCODER_MAX_SOURCE_BYTES:-}" ]]; then
  put_secret ENCODER_MAX_SOURCE_BYTES "$ENCODER_MAX_SOURCE_BYTES"
fi

if [[ -n "${ENCODER_MAX_DURATION_SEC:-}" ]]; then
  put_secret ENCODER_MAX_DURATION_SEC "$ENCODER_MAX_DURATION_SEC"
fi

echo "Done. Deploy with: npm run deploy"
