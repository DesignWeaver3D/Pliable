"""Finding a request that never returns or is very slow: when one runs too long, a timer writes every thread's stack once to the error stream (core.log in the desktop app)."""

import faulthandler
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from typing import TextIO

SLOW_REQUEST_SECONDS = 30.0


@contextmanager
def watching(seconds: float = SLOW_REQUEST_SECONDS, stream: TextIO | None = None) -> Iterator[None]:
    """Around one request: after `seconds` the stacks of all threads are written once to `stream`
    (default: the error stream); the request handler's frames name the request. The dump comes from a C-level timer, so it also works
    when native code holds the interpreter. One dump timer exists per process, so overlapping requests of several connections
    cancel each other's: the last one armed is watched."""
    target = stream or sys.stderr
    try:
        target.fileno()
    except (AttributeError, OSError, ValueError):
        yield  # no real error stream to write to (a windowed process): nothing to watch with
        return
    faulthandler.dump_traceback_later(seconds, repeat=False, file=target)
    try:
        yield
    finally:
        faulthandler.cancel_dump_traceback_later()
