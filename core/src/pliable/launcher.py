"""Portable entry point: serves the built frontend and the core on one port, opens the browser, and exits
when the last tab has been closed. This is what the packaged alpha runs (`pliable-app`)."""

import argparse
import asyncio
import logging
import socket
import sys
import threading
import webbrowser
from pathlib import Path

from . import __version__, diagnostics
from .server import run

PREFERRED_PORT = 8765
IDLE_EXIT_SECONDS = 20.0  # long enough to survive a page reload or a browser throttling a background tab


def frontend_dir() -> Path:
    """Built frontend: next to the frozen executable's data, or app/dist in a source checkout."""
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent)) / "frontend"
    return Path(__file__).resolve().parents[3] / "app" / "dist"


def free_port(host: str) -> int:
    """The preferred port if it is free, else any free one."""
    for candidate in (PREFERRED_PORT, 0):
        with socket.socket() as probe:
            try:
                probe.bind((host, candidate))
            except OSError:
                continue
            return probe.getsockname()[1]
    raise OSError("No free port found")


def main():
    parser = argparse.ArgumentParser(description="Pliable alpha: geometry core and web app in one program")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0, help="0 picks a free port")
    parser.add_argument("--no-browser", action="store_true", help="do not open a browser (used by the smoke test)")
    parser.add_argument("--keep-running", action="store_true", help="do not exit when the browser tab closes")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(name)s %(message)s")
    diagnostics.install()
    static = frontend_dir()
    if not (static / "index.html").is_file():
        sys.exit(f"Frontend not found at {static}. Build it with 'npm run build' in app/.")
    port = args.port or free_port(args.host)
    url = f"http://{args.host}:{port}/"
    print(f"Pliable {__version__} (alpha) running at {url}", flush=True)
    print("Close the browser tab to quit, or press Ctrl+C here.", flush=True)
    if not args.no_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        asyncio.run(run(args.host, port, static_dir=static, exit_when_idle=None if args.keep_running else IDLE_EXIT_SECONDS))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
