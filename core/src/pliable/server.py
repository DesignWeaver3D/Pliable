"""WebSocket server that exposes the geometry core to the frontend.

Each connection gets its own session with one open document. Requests are
JSON objects with an "id" and a "type"; every request gets exactly one
reply carrying the same id. Replies that include a mesh are binary frames
(see protocol.py), everything else is JSON.
"""

import argparse
import asyncio
import base64
import json
import logging
import time
from http import HTTPStatus
from pathlib import Path
from urllib.parse import unquote

from websockets.asyncio.server import ServerConnection, serve
from websockets.datastructures import Headers
from websockets.http11 import Response

from . import __version__, sketch
from .autosave import Autosaver
from .demos import load_demo
from . import diagnostics
from .usage import Usage
from .document import Document
from .features import combine
from .files import read_step, read_step_checked, write_mesh, write_step
from OCP.gp import gp_Vec
from .measure import measure, model_info
from .ops import OperationError, solids_of
from .protocol import encode_mesh
from .edgesel import face_edges, face_loops, shared_loop
from .relations import find_related, tangent_chain
from .tessellate import tessellate
from .tools import TOOLS, Selection, get_tool
from .topology import Topology

log = logging.getLogger("pliable.server")


class RequestError(Exception):
    pass


def _ms(start: float) -> float:
    return round((time.perf_counter() - start) * 1000, 2)


class Session:
    def __init__(self, autosaver: Autosaver | None = None):
        self.document: Document | None = None
        self.autosaver = autosaver
        self.usage = Usage()  # local tool-usage counts, shown in the diagnostics report only
        self.last_tool: dict | None = None  # name and outcome of the newest tool run, for diagnostics
        self.import_warnings: list[str] = []
        self.unclean = autosaver.available() if autosaver else None  # offered once, if the previous run was killed
        if self.unclean and self.unclean["clean"]:
            self.unclean = None

    def _autosave(self, fresh: bool = False):
        if self.autosaver and self.document:
            self.autosaver.save(self.document, fresh)

    def _require_document(self) -> Document:
        if self.document is None:
            raise RequestError("No document is open")
        return self.document

    def _mesh_reply(self, topology: Topology, timings: dict, **extra) -> bytes:
        start = time.perf_counter()
        mesh = tessellate(topology)
        timings["meshMs"] = _ms(start)
        header = {"kind": "mesh", "timings": timings, **extra}
        if self.document is not None:
            header["canUndo"] = self.document.can_undo
            header["canRedo"] = self.document.can_redo
        return encode_mesh(header, mesh)

    def _open(self, shape, name: str) -> bytes:
        self.document = Document(shape, name)
        self._autosave(fresh=True)
        return self._mesh_reply(self.document.current, {}, name=name)

    def handle(self, request: dict) -> dict | bytes:
        kind = request.get("type")
        if kind == "hello":
            reply = {"version": __version__}
            if self.unclean:
                reply["restore"] = self.unclean
            return reply
        if kind == "restore_session":
            document = self.autosaver.restore() if self.autosaver else None
            if document is None:
                raise RequestError("Nothing to restore")
            self.document = document
            self.unclean = None
            self._autosave(fresh=True)
            return self._mesh_reply(document.current, {}, name=document.name)
        if kind == "open_demo":
            return self._open(load_demo(request["name"]), request["name"])
        if kind == "import_step":
            start = time.perf_counter()
            shape, warnings = read_step_checked(base64.b64decode(request["data"]))
            self.document = Document(shape, request.get("name", "Imported"))
            self.import_warnings = warnings
            self._autosave(fresh=True)
            return self._mesh_reply(self.document.current, {"importMs": _ms(start)}, name=self.document.name, warnings=warnings, solids=len(solids_of(shape)))
        if kind == "diagnostics":
            return {"report": diagnostics.core_report(self.last_tool, self.import_warnings, self.usage.report())}
        if kind == "usage_event":
            self.usage.record(request.get("tool"), request.get("event"), request.get("surface"))
            return {}
        if kind == "usage_clear":
            self.usage.clear()
            return {}
        if kind == "list_tools":
            return {"tools": [tool.describe() for tool in TOOLS.values()]}
        if kind == "available_tools":
            topology = self._require_document().current
            selection = Selection.from_json(request.get("selection"))
            return {"tools": [t.id for t in TOOLS.values() if t.available(topology, selection)]}
        if kind == "measure":
            topology = self._require_document().current
            try:
                return measure(topology, Selection.from_json(request.get("selection")))
            except KeyError as e:
                raise RequestError(e.args[0]) from e
        if kind == "combine_step":
            document = self._require_document()
            start = time.perf_counter()
            other = read_step(base64.b64decode(request["data"]))
            offset = gp_Vec(float(request.get("dx", 0)), float(request.get("dy", 0)), float(request.get("dz", 0)))
            result = combine(document.current.shape, other, str(request.get("mode", "union")), offset)
            target = document.commit(result.shape)
            self._autosave()
            return self._mesh_reply(target, {"opMs": _ms(start)}, selection=Selection().to_json())
        if kind == "related":
            topology = self._require_document().current
            try:
                return {"rules": find_related(topology, int(request["face"]))}
            except (KeyError, ValueError, TypeError) as e:
                raise RequestError("Unknown face") from e
        if kind == "edge_chain":
            topology = self._require_document().current
            try:
                return {"edges": tangent_chain(topology, int(request["edge"]))}
            except (KeyError, ValueError, TypeError) as e:
                raise RequestError("Unknown edge") from e
        if kind == "edge_selection":
            topology = self._require_document().current
            mode = request.get("mode")
            try:
                if mode == "face_edges":
                    return {"edges": face_edges(topology, int(request["face"]))}
                if mode == "face_loops":
                    return {"loops": face_loops(topology, int(request["face"]))}
                if mode == "shared_loop":
                    return {"edges": shared_loop(topology, int(request["first"]), int(request["second"]))}
            except (KeyError, ValueError, TypeError) as e:
                raise RequestError("Unknown face or edge") from e
            raise RequestError(f"Unknown edge selection mode {mode!r}")
        if kind == "model_info":
            return model_info(self._require_document().current)
        if kind == "sketch_plane":
            plane = self._sketch_plane(request)
            reply = {"plane": plane}
            if "face" in request:  # outline of the face as fixed reference geometry
                reply["reference"] = sketch.face_reference(self._require_document().current.face(int(request["face"])), plane)
            return reply
        if kind == "sketch_solve":
            try:
                result = sketch.solve(request["sketch"], request.get("drag"))
            except (KeyError, TypeError, ValueError) as e:
                raise RequestError(f"Malformed sketch: {e!r}") from e
            return result
        if kind == "sketch_extrude":
            return self._sketch_extrude(request)
        if kind == "sketch_offset":
            try:
                return sketch.offset_entities(request["sketch"], [int(i) for i in request["entities"]], float(request["distance"]))
            except (KeyError, TypeError, ValueError) as e:
                raise RequestError(f"Malformed sketch request: {e!r}") from e
        if kind == "sketch_project":
            return self._sketch_project(request)
        if kind == "sketch_regions":
            return self._sketch_regions(request)
        if kind in ("tool_preview", "tool_commit"):
            return self._run_tool(request, commit=kind == "tool_commit")
        if kind in ("undo", "redo"):
            document = self._require_document()
            changed = document.undo() if kind == "undo" else document.redo()
            if not changed:
                raise RequestError(f"Nothing to {kind}")
            self._autosave()
            return self._mesh_reply(document.current, {})
        if kind == "export_step":
            document = self._require_document()
            data = write_step(document.current.shape)
            return {"name": document.name, "data": base64.b64encode(data).decode()}
        if kind == "export_mesh":
            document = self._require_document()
            try:
                data = write_mesh(document.current.shape, str(request.get("format")))
            except ValueError as e:
                raise RequestError(str(e)) from e
            return {"name": document.name, "data": base64.b64encode(data).decode()}
        raise RequestError(f"Unknown request type {kind!r}")

    def _sketch_plane(self, request: dict) -> dict:
        if "plane" in request:
            try:
                return sketch.offset_plane(sketch.STANDARD_PLANES[request["plane"]], float(request.get("offset", 0)))
            except KeyError:
                raise RequestError(f"Unknown plane {request['plane']!r}") from None
            except (TypeError, ValueError) as e:
                raise RequestError(f"Malformed plane request: {e!r}") from e
        topology = self._require_document().current
        try:
            return sketch.face_plane(topology.face(int(request["face"])))
        except KeyError as e:
            raise RequestError("Unknown face") from e

    def _sketch_project(self, request: dict) -> dict:
        topology = self._require_document().current
        return sketch.face_reference(topology.shape, request["plane"], project=True)

    def _sketch_regions(self, request: dict) -> bytes:
        """Leave a sketch: its closed regions become faces of the model (imprinted or loose) and stay selected."""
        document = self._require_document()
        start = time.perf_counter()
        try:
            shape, count = sketch.add_regions(document.current.shape, request["sketch"])
        except (KeyError, TypeError, ValueError) as e:
            raise RequestError(f"Malformed sketch request: {e!r}") from e
        timings = {"opMs": _ms(start)}
        target = document.commit(shape)
        self._autosave()
        return self._mesh_reply(target, timings, preview=False, selection=Selection().to_json())

    def _sketch_extrude(self, request: dict) -> bytes:
        document = self._require_document()
        commit = bool(request.get("commit"))
        start = time.perf_counter()
        try:
            if "axis" in request:  # revolve about a sketch line instead of extruding
                result = sketch.revolve(document.current.shape, request["sketch"], int(request["axis"]), float(request["distance"]), str(request.get("mode", "join")))
            else:
                result = sketch.extrude(document.current.shape, request["sketch"], float(request["distance"]), str(request.get("mode", "join")), bool(request.get("symmetric")))
        except (KeyError, TypeError, ValueError) as e:
            raise RequestError(f"Malformed sketch request: {e!r}") from e
        timings = {"opMs": _ms(start)}
        target = document.commit(result.shape) if commit else Topology(result.shape)
        if commit:
            self._autosave()
        return self._mesh_reply(target, timings, preview=not commit, selection=Selection().to_json())

    def _run_tool(self, request: dict, commit: bool) -> bytes:
        document = self._require_document()
        topology = document.current
        tool = get_tool(str(request.get("tool")))
        selection = Selection.from_json(request.get("selection"))
        start = time.perf_counter()
        self.last_tool = {"tool": tool.id, "commit": commit, "ok": False, "error": None}
        try:
            result = tool.execute(topology, selection, request.get("params") or {}, preview=not commit)
        except Exception as e:
            self.last_tool["error"] = diagnostics.scrub(f"{type(e).__name__}: {e}")
            raise
        self.last_tool["ok"] = True
        timings = {"opMs": _ms(start)}
        target = document.commit(result.shape) if commit else Topology(result.shape)
        if commit:
            self._autosave()
        faces = [i for f in result.tracked_faces if (i := target.face_id(f)) is not None]
        edges = [i for e in result.tracked_edges if (i := target.edge_id(e)) is not None]
        vertices = [i for v in result.tracked_vertices if (i := target.vertex_id(v)) is not None]
        selection = Selection(faces=faces, edges=edges, vertices=vertices)
        return self._mesh_reply(target, timings, preview=not commit, selection=selection.to_json())


async def _handle_connection(connection: ServerConnection, autosaver: Autosaver | None = None):
    session = Session(autosaver)
    log.info("client connected")
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
    asyncio.run(run(args.host, args.port))


if __name__ == "__main__":
    main()
