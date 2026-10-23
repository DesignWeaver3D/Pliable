"""Pieces every request handler module and the server share."""

import logging
import time

log = logging.getLogger("pliable.server")


class RequestError(Exception):
    pass


def _ms(start: float) -> float:
    return round((time.perf_counter() - start) * 1000, 2)
