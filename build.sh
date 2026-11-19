#!/bin/sh
# Build the desktop app for this computer (macOS or Linux); see scripts/build.py.
# Every prerequisite is checked first and all missing ones are listed together. ./build.sh --check only checks.
set -eu
cd "$(dirname "$0")"
NODE_URL="https://nodejs.org/en/download"
LINUX_URL="https://v2.tauri.app/start/prerequisites/#linux"
LINUX_PACKAGES="pkg-config build-essential libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev"
missing=""

need() {
    missing="$missing
  - $1"
}

has() {
    command -v "$1" >/dev/null 2>&1
}

node_version_ok() {
    version=${1#v}
    version=${version%%[-+]*}
    major=${version%%.*}
    rest=${version#*.}
    minor=${rest%%.*}
    case "$version" in
        *.*) ;;
        *) return 1 ;;
    esac
    case "$major.$minor" in
        *[!0-9.]* | .* | *.) return 1 ;;
    esac
    [ "$major" -ge 23 ] || { [ "$major" -eq 22 ] && [ "$minor" -ge 12 ]; } || { [ "$major" -eq 20 ] && [ "$minor" -ge 19 ]; }
}

check_node() {
    if ! has node; then
        need "Node.js 20.19+ or 22.12+: $NODE_URL"
        return
    fi
    node_version=$(node --version 2>/dev/null || true)
    if ! node_version_ok "$node_version"; then
        need "Node.js 20.19+ or 22.12+ (found ${node_version:-no version}): $NODE_URL"
    elif ! has npm; then
        need "npm (comes with Node.js): $NODE_URL"
    fi
}

check_linux() {
    [ "$(uname -m)" = "x86_64" ] || need "an x86_64 computer: the Linux AppImage is built for x86_64 only (this one is $(uname -m))"
    has cc || need "a C compiler: sudo apt-get install build-essential (Debian, Ubuntu); others: $LINUX_URL"
    if ! has pkg-config; then
        need "pkg-config and the WebKitGTK development libraries: sudo apt-get install $LINUX_PACKAGES (Debian, Ubuntu); others: $LINUX_URL"
        return
    fi
    libraries=""
    for library in webkit2gtk-4.1 gtk+-3.0 librsvg-2.0; do
        pkg-config --exists "$library" || libraries="${libraries:+$libraries }$library"
    done
    [ -z "$libraries" ] || need "development libraries ($libraries): sudo apt-get install $LINUX_PACKAGES (Debian, Ubuntu); others: $LINUX_URL"
}

has uv || need "uv: https://docs.astral.sh/uv/getting-started/installation/"
check_node
has cargo || need "Rust: https://rustup.rs"
case "$(uname -s)" in
    Darwin) xcode-select -p >/dev/null 2>&1 || need "Xcode Command Line Tools: run xcode-select --install" ;;
    Linux) check_linux ;;
    *) need "macOS or Linux (on Windows, run build.bat)" ;;
esac
if [ -n "$missing" ]; then
    printf 'Install these first, then run ./build.sh again:%s\nOpen a new terminal after installing, so the new tools are found.\n' "$missing" >&2
    exit 1
fi
if [ "${1:-}" = "--check" ]; then
    echo "All prerequisites found."
    exit 0
fi
exec uv run --project core python scripts/build.py "$@"
