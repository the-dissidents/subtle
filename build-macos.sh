#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST_DIR="${SCRIPT_DIR}/src-tauri"

# Resolve the cached FFmpeg source.  The build always uses the cached checkout
# (never letting ffmpeg-sys-next clone on its own); warn and abort if it is
# missing so the user can fetch it first.
FFMPEG_CACHE_DIR="${FFMPEG_CACHE_DIR:-${HOME}/.cache/subtle-ffmpeg}"

if [[ -n "${FFMPEG_SOURCE_PATH:-}" ]]; then
    FFMPEG_SOURCE="${FFMPEG_SOURCE_PATH}"
else
    FFMPEG_VERSION=""
    if [[ -f "${MANIFEST_DIR}/Cargo.lock" ]]; then
        FFMPEG_VERSION="$(awk '
            /^name = "ffmpeg-sys-next"$/ { found = 1; next }
            found && /^version = / {
                gsub(/"/, "", $3)
                split($3, v, ".")
                print v[1] "." v[2]
                exit
            }
        ' "${MANIFEST_DIR}/Cargo.lock")"
    fi
    FFMPEG_VERSION="${FFMPEG_VERSION:-7.1}"
    FFMPEG_SOURCE="${FFMPEG_CACHE_DIR}/ffmpeg-${FFMPEG_VERSION}"
fi

if [[ ! -f "${FFMPEG_SOURCE}/configure" ]]; then
    echo "WARNING: cached FFmpeg source not found at: ${FFMPEG_SOURCE}" >&2
    echo "Run './build-with-ffmpeg-cache.sh' first to clone it, or set FFMPEG_SOURCE_PATH to a local FFmpeg checkout." >&2
    exit 1
fi

export FFMPEG_SOURCE_PATH="${FFMPEG_SOURCE}"

cargo tauri build --target universal-apple-darwin --bundles app
bash "${SCRIPT_DIR}/mac-repack-test.sh"
