"""The websocket server around Session: one session per connection, the optional static file server for the built frontend, and the command line."""

import argparse
import asyncio
import faulthandler
import json
import logging
import time
from http import HTTPStatus
from pathlib import Path
from urllib.parse import unquote

from websockets.asyncio.server import ServerConnection, serve
from websockets.datastructures import Headers
from websockets.http11 import Response

from . import __version__, diagnostics
from .autosave import Autosaver
from .handlers.common import RequestError, _ms, log
from .handlers.session import _parked
from .ops import OperationError


async def _handle_connection(connection: ServerConnection, autosaver: Autosaver | None = None):
    from .server import Session  # here, not at the top: server.py imports this module
    session = Session(autosaver)
    log.info("client connected")
    try:
        async for message in connection:
            if isinstance(message, bytes):
                continue
            request = json.loads(message)
            request_id = request.get("id")
            start = time.perf_counter()
            try:
                # Geometry work runs off the event loop so the connection stays responsive.
                reply = await asyncio.to_thread(session.handle, request)
            except (RequestError, OperationError) as e:
                reply = {"ok": False, "error": str(e)}
            except Exception as e:
                log.exception("request %s failed", request.get("type"))
                reply = {"ok": False, "error": f"Internal error: {e}"}
            if isinstance(reply, bytes):
                # The reply id goes in a small JSON frame sent immediately before
                # the binary frame, so the mesh header doesn't need re-encoding.
                await connection.send(json.dumps({"id": request_id, "ok": True, "binary": True, "serverMs": _ms(start)}))
                await connection.send(reply)
            else:
                reply.setdefault("ok", True)
                reply["id"] = request_id
                reply["serverMs"] = _ms(start)
                await connection.send(json.dumps(reply))
    finally:
        if session.document is not None:
            _parked["document"] = session.document
    log.info("client disconnected")


_TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
          ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".wasm": "application/wasm", ".map": "application/json"}


def _static_handler(root: Path):
    """HTTP handler for the websocket server: serves the built frontend, lets websocket upgrades through."""
    root = root.resolve()

    def process_request(connection, request):
        if request.headers.get("Upgrade", "").lower() == "websocket":
            return None
        path = request.path.split("?", 1)[0].split("#", 1)[0]
        target = (root / unquote(path).lstrip("/")).resolve()
        if path in ("", "/") or target.is_dir():
            target = root / "index.html"
        if root not in target.parents and target != root / "index.html" or not target.is_file():
            return connection.respond(HTTPStatus.NOT_FOUND, "Not found\n")
        body = target.read_bytes()
        headers = Headers([("Content-Type", _TYPES.get(target.suffix.lower(), "application/octet-stream")),
                           ("Content-Length", str(len(body))), ("Cache-Control", "no-cache")])
        return Response(200, "OK", headers, body)

    return process_request


async def run(host: str, port: int, autosaver: Autosaver | None = None, static_dir: Path | None = None,
              exit_when_idle: float | None = None, ready: "asyncio.Future | None" = None):
    """Serve the core. With `static_dir` the frontend is served too (same port). With `exit_when_idle` the server
    stops that many seconds after the last browser tab disconnects (never before the first one connects)."""
    autosaver = autosaver or Autosaver()
    connections = 0
    idle_timer: asyncio.TimerHandle | None = None
    stop = asyncio.get_running_loop().create_future()

    def stop_now():
        if not stop.done():
            log.info("no browser tab connected for %.0f s, shutting down", exit_when_idle)
            stop.set_result(None)

    async def handler(connection: ServerConnection):
        nonlocal connections, idle_timer
        connections += 1
        if idle_timer:
            idle_timer.cancel()
            idle_timer = None
        try:
            await _handle_connection(connection, autosaver)
        finally:
            connections -= 1
            if exit_when_idle is not None and connections == 0:
                idle_timer = asyncio.get_running_loop().call_later(exit_when_idle, stop_now)

    process_request = _static_handler(static_dir) if static_dir else None
    try:
        async with serve(handler, host, port, max_size=256 * 1024 * 1024, ping_interval=None,
                         process_request=process_request) as server:
            bound = server.sockets[0].getsockname()[1]
            log.info("Pliable core %s listening on ws://%s:%d (autosave in %s)", __version__, host, bound, autosaver.folder)
            if ready is not None and not ready.done():
                ready.set_result(bound)
            if exit_when_idle is None:
                await server.serve_forever()
            else:
                await stop
    finally:
        autosaver.mark_clean()


def main():
    parser = argparse.ArgumentParser(description="Pliable geometry core server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(name)s %(message)s")
    diagnostics.install()
    faulthandler.enable()  # a native crash leaves a traceback on the console instead of a silent exit
    asyncio.run(run(args.host, args.port))

