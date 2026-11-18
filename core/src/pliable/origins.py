"""Which pages may open a connection to the core: only pages served from this computer (or from the address the core was told to listen on)."""

import re

LOCAL_HOSTS = ("localhost", "127.0.0.1", "[::1]")


def allowed_origins(host: str) -> list[re.Pattern[str] | None]:
    """The `Origin` values the websocket accepts. A web page always sends its origin, so a page from any other site is
    refused before it can send a request. A program that is not a browser sends none and is let through: it runs on
    this computer and could reach the core in any case."""
    served = f"[{host}]" if ":" in host and not host.startswith("[") else host
    names = "|".join(re.escape(name) for name in sorted({*LOCAL_HOSTS, served.lower()}))
    return [None, re.compile(rf"https?://({names})(:\d+)?")]
