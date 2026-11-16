#!/bin/sh
# Build the desktop app for this computer (macOS or Linux); see scripts/build.py.
set -e
cd "$(dirname "$0")"
command -v uv >/dev/null 2>&1 || { echo "uv is required: https://docs.astral.sh/uv" >&2; exit 1; }
exec uv run --project core python scripts/build.py "$@"
