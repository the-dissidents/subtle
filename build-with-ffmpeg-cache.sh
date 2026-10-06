#!/usr/bin/env bash
#
# Build subtle while reusing a locally cached FFmpeg source checkout.
#
# ffmpeg-sys-next's build script clones FFmpeg from GitHub on every fresh
# build, which is slow and frequently fails on flaky connections.  Setting
# the FFMPEG_SOURCE_PATH environment variable makes it copy from a local
# checkout instead of cloning.  This script makes sure such a checkout
# exists (cloning it with retries/backoff if necessary) and then runs
# `cargo` with that variable exported.
#
# Usage:
#   ./build-with-ffmpeg-cache.sh                 # runs `cargo build`
#   ./build-with-ffmpeg-cache.sh check           # runs `cargo check`
#   ./build-with-ffmpeg-cache.sh tauri build     # runs `cargo tauri build`
#   ./build-with-ffmpeg-cache.sh --update check  # refresh clone, then check
#
# Environment variables:
#   FFMPEG_CACHE_DIR     Where to keep the FFmpeg checkout.
#                        Default: ~/.cache/subtle-ffmpeg
#   FFMPEG_REPO          FFmpeg git URL.
#                        Default: https://github.com/FFmpeg/FFmpeg
#   FFMPEG_VERSION       FFmpeg major.minor version.
#                        Default: parsed from src-tauri/Cargo.lock.
#   FFMPEG_PROXY         HTTP(S) proxy used for the FFmpeg clone/fetch and for
#                        cargo. Set to an empty string to disable.
#                        Default: http://127.0.0.1:7890
#   CLONE_RETRIES        Max clone/update attempts. Default: 10.
#   CLONE_RETRY_DELAY    Base delay (seconds) between attempts. Default: 5.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST_DIR="${SCRIPT_DIR}/src-tauri"

FFMPEG_REPO="${FFMPEG_REPO:-https://github.com/FFmpeg/FFmpeg}"
CACHE_DIR="${FFMPEG_CACHE_DIR:-${HOME}/.cache/subtle-ffmpeg}"
FFMPEG_PROXY="${FFMPEG_PROXY:-http://127.0.0.1:7890}"
CLONE_RETRIES="${CLONE_RETRIES:-10}"
CLONE_RETRY_DELAY="${CLONE_RETRY_DELAY:-5}"

log() {
    printf '%s\n' "$*" >&2
}

# Extra `git -c` arguments for reliable cloning over a flaky connection,
# optionally routing through the proxy.  Setting http.lowSpeedLimit to 0
# keeps git from aborting on slow links (the usual failure mode on bad
# connections), and http.postBuffer is raised to avoid "RPC failed" errors
# when the proxy buffers the pack.
GIT_CONF=(
    -c http.postBuffer=524288000
    -c http.lowSpeedLimit=0
    -c http.lowSpeedTime=999999
)
if [[ -n "${FFMPEG_PROXY}" ]]; then
    GIT_CONF+=(-c "http.proxy=${FFMPEG_PROXY}" -c "https.proxy=${FFMPEG_PROXY}")
fi

# Extract major.minor from the ffmpeg-sys-next entry in Cargo.lock.
parse_ffmpeg_version() {
    local lockfile="${MANIFEST_DIR}/Cargo.lock"
    [[ -f "$lockfile" ]] || return 0
    awk '
        /^name = "ffmpeg-sys-next"$/ { found = 1; next }
        found && /^version = / {
            gsub(/"/, "", $3)
            split($3, v, ".")
            print v[1] "." v[2]
            exit
        }
    ' "$lockfile"
}

FFMPEG_VERSION="${FFMPEG_VERSION:-$(parse_ffmpeg_version)}"
FFMPEG_VERSION="${FFMPEG_VERSION:-7.1}"
FFMPEG_BRANCH="release/${FFMPEG_VERSION}"
SRC_DIR="${CACHE_DIR}/ffmpeg-${FFMPEG_VERSION}"

# A valid checkout has both a .git directory and the FFmpeg configure script.
is_valid_checkout() {
    [[ -d "${SRC_DIR}/.git" && -f "${SRC_DIR}/configure" ]]
}

# Clone FFmpeg with retries/backoff, removing any partial checkout between
# attempts.  git is configured to keep going on slow connections instead of
# aborting (which is the usual failure mode on flaky links).
clone_with_retries() {
    local attempt=1
    while true; do
        log "Cloning ${FFMPEG_REPO} (${FFMPEG_BRANCH}) into ${SRC_DIR} (attempt ${attempt}/${CLONE_RETRIES})"
        if git "${GIT_CONF[@]}" \
            clone --depth=1 --single-branch -b "${FFMPEG_BRANCH}" \
            "${FFMPEG_REPO}" "${SRC_DIR}"; then
            return 0
        fi
        attempt=$((attempt + 1))
        if ((attempt > CLONE_RETRIES)); then
            log "Giving up after ${CLONE_RETRIES} attempts."
            return 1
        fi
        rm -rf "${SRC_DIR}"
        sleep $((CLONE_RETRY_DELAY * attempt))
    done
}

# Ensure a valid checkout exists, cloning it if it is missing or incomplete.
ensure_source() {
    if is_valid_checkout; then
        log "Using cached FFmpeg source at ${SRC_DIR}"
        return 0
    fi
    if [[ -e "${SRC_DIR}" ]]; then
        log "Removing incomplete checkout at ${SRC_DIR}"
        rm -rf "${SRC_DIR}"
    fi
    mkdir -p "${CACHE_DIR}"
    clone_with_retries
}

# Fetch the latest tip of the branch into an existing checkout, with the same
# retry/backoff behaviour as the initial clone.
update_source() {
    ensure_source
    local attempt=1
    while true; do
        log "Updating FFmpeg source at ${SRC_DIR} (attempt ${attempt}/${CLONE_RETRIES})"
        if git -C "${SRC_DIR}" "${GIT_CONF[@]}" \
            fetch --depth=1 origin "${FFMPEG_BRANCH}" \
            && git -C "${SRC_DIR}" reset --hard FETCH_HEAD; then
            return 0
        fi
        attempt=$((attempt + 1))
        if ((attempt > CLONE_RETRIES)); then
            log "Giving up after ${CLONE_RETRIES} attempts."
            return 1
        fi
        sleep $((CLONE_RETRY_DELAY * attempt))
    done
}

UPDATE=0
ARGS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --update)
            UPDATE=1
            shift
            ;;
        --)
            shift
            ARGS+=("$@")
            break
            ;;
        *)
            ARGS+=("$1")
            shift
            ;;
    esac
done

if [[ "$UPDATE" -eq 1 ]]; then
    update_source
else
    ensure_source
fi

if [[ ${#ARGS[@]} -eq 0 ]]; then
    ARGS=("build")
fi

cd "${MANIFEST_DIR}"
export FFMPEG_SOURCE_PATH="${SRC_DIR}"
if [[ -n "${FFMPEG_PROXY}" ]]; then
    export http_proxy="${FFMPEG_PROXY}"
    export https_proxy="${FFMPEG_PROXY}"
    export HTTP_PROXY="${FFMPEG_PROXY}"
    export HTTPS_PROXY="${FFMPEG_PROXY}"
fi
log "Running: cargo ${ARGS[*]}"
exec cargo "${ARGS[@]}"
