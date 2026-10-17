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

from websockets.asyncio.server import ServerConnection, serve

from . import __version__
from .demos import load_demo
from .document import Document
from .files import read_step, write_step
from .ops import OperationError
from .protocol import encode_mesh
from .tessellate import tessellate
from .tools import TOOLS, Selection, get_tool
from .topology import Topology

log = logging.getLogger("pliable.server")


class RequestError(Exception):
    pass


def _ms(start: float) -> float:
    return round((time.perf_counter() - start) * 1000, 2)


class Session:
    def __init__(self):
        self.document: Document | None = None

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
        return self._mesh_reply(self.document.current, {}, name=name)

    def handle(self, request: dict) -> dict | bytes:
        kind = request.get("type")
        if kind == "hello":
            return {"version": __version__}
        if kind == "open_demo":
            return self._open(load_demo(request["name"]), request["name"])
        if kind == "import_step":
            start = time.perf_counter()
            shape = read_step(base64.b64decode(request["data"]))
            self.document = Document(shape, request.get("name", "Imported"))
            return self._mesh_reply(self.document.current, {"importMs": _ms(start)}, name=self.document.name)
        if kind == "list_tools":
            return {"tools": [tool.describe() for tool in TOOLS.values()]}
        if kind == "available_tools":
            topology = self._require_document().current
            selection = Selection.from_json(request.get("selection"))
            return {"tools": [t.id for t in TOOLS.values() if t.available(topology, selection)]}
        if kind in ("tool_preview", "tool_commit"):
            return self._run_tool(request, commit=kind == "tool_commit")
        if kind in ("undo", "redo"):
            document = self._require_document()
            changed = document.undo() if kind == "undo" else document.redo()
            if not changed:
                raise RequestError(f"Nothing to {kind}")
            return self._mesh_reply(document.current, {})
        if kind == "export_step":
            document = self._require_document()
            data = write_step(document.current.shape)
            return {"name": document.name, "data": base64.b64encode(data).decode()}
        raise RequestError(f"Unknown request type {kind!r}")

    def _run_tool(self, request: dict, commit: bool) -> bytes:
        document = self._require_document()
        topology = document.current
        tool = get_tool(str(request.get("tool")))
        selection = Selection.from_json(request.get("selection"))
        start = time.perf_counter()
        result = tool.execute(topology, selection, request.get("params") or {}, preview=not commit)
        timings = {"opMs": _ms(start)}
        target = document.commit(result.shape) if commit else Topology(result.shape)
        faces = [i for f in result.tracked_faces if (i := target.face_id(f)) is not None]
        edges = [i for e in result.tracked_edges if (i := target.edge_id(e)) is not None]
        vertices = [i for v in result.tracked_vertices if (i := target.vertex_id(v)) is not None]
        selection = Selection(faces=faces, edges=edges, vertices=vertices)
        return self._mesh_reply(target, timings, preview=not commit, selection=selection.to_json())


async def _handle_connection(connection: ServerConnection):
    session = Session()
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


async def run(host: str, port: int):
    async with serve(_handle_connection, host, port, max_size=256 * 1024 * 1024) as server:
        log.info("Pliable core %s listening on ws://%s:%d", __version__, host, port)
        await server.serve_forever()


def main():
    parser = argparse.ArgumentParser(description="Pliable geometry core server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(name)s %(message)s")
    asyncio.run(run(args.host, args.port))


if __name__ == "__main__":
    main()
