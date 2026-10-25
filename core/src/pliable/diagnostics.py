"""Text for the Copy diagnostics button: versions, recent log lines, last tool run.

Nothing here may carry model data, file paths, user names or other personal data.
"""

import collections
import getpass
import logging
import os
import platform
import re
import sys
import time

import build123d
import OCP

from . import __version__

LOG_LINES = 50
STARTED = time.time()
_PATH = re.compile(r"(?:[A-Za-z]:)?(?:[\\/][^\\/\s'\x22]+)+[\\/]([^\\/\s'\x22]+)")


def scrub(text: str) -> str:
    """Reduce file paths to base names and drop the account name."""
    text = _PATH.sub(r"\1", text)
    try:
        user = getpass.getuser()
    except Exception:
        user = ""
    return text.replace(user, "<user>") if len(user) > 2 else text


class RingHandler(logging.Handler):
    """Keeps the last few log lines in memory."""

    def __init__(self, size: int = LOG_LINES):
        super().__init__()
        self.lines = collections.deque(maxlen=size)
        self.setFormatter(logging.Formatter("%(asctime)s %(name)s %(message)s"))

    def emit(self, record):
        try:
            self.lines.append(scrub(self.format(record)).replace("\n", " | "))
        except Exception:
            pass


RING = RingHandler()


def install():
    """Start collecting log lines from the whole core."""
    root = logging.getLogger()
    if RING not in root.handlers:
        root.addHandler(RING)
    if root.level == logging.NOTSET or root.level > logging.INFO:
        root.setLevel(logging.INFO)


def core_report(last_tool: dict | None, import_warnings: list[str], usage: dict | None = None, model: dict | None = None) -> dict:
    return {
        "pliable": __version__,
        "packaged": bool(getattr(sys, "frozen", False)),
        "shell": os.environ.get("PLIABLE_SHELL") or None,  # set by the desktop window; none when run from a browser
        "machine": platform.machine(),
        "cpus": os.cpu_count(),
        "uptimeSeconds": int(time.time() - STARTED),
        "model": model or {},
        "python": sys.version.split()[0],
        "os": f"{platform.system()} {platform.release()} ({platform.version()})",
        "opencascade": getattr(OCP, "__version__", "unknown"),
        "build123d": build123d.__version__,
        "lastTool": last_tool,
        "usage": usage or {},
        "importWarnings": [scrub(w) for w in import_warnings],
        "log": list(RING.lines),
    }
