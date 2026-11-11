"""WebSocket server that exposes the geometry core to the frontend.

Each connection gets its own session with one open document. Requests are
JSON objects with an "id" and a "type"; every request gets exactly one
reply carrying the same id. Replies that include a mesh are binary frames
(see protocol.py), everything else is JSON.
"""

import time

from . import sketch, unwrap
from .sketch.freedomparts import point_freedom_by_part
from .sketch.sizefreedom import free_circle_sizes
from .usage import Usage
from .document import Document
from .ghost import ghost_reply
from .autosave import Autosaver
from .ops import solids_of
from .protocol import encode_mesh  # noqa: F401  (the benchmark patches server.encode_mesh)
from .tessellate import tessellate  # noqa: F401  (the benchmark patches server.tessellate)
from .topology import Topology
from .handlers.sketch import SketchHandlers
from .handlers.datum import DatumHandlers
from .handlers.tools import ToolHandlers
from .handlers.session import SessionHandlers, _parked  # noqa: F401  (tests reach server._parked)
from .handlers.queries import QueryHandlers
from .handlers.bodies import BodyHandlers
from .handlers.files import FileHandlers
from .handlers.common import RequestError, _ms, log  # noqa: F401
from .ops import OperationError  # noqa: F401
from .serving import main, run  # noqa: F401  (launcher.py imports run; the console script imports main)


class Session(SketchHandlers, DatumHandlers, ToolHandlers, SessionHandlers, QueryHandlers, BodyHandlers, FileHandlers):
    def __init__(self, autosaver: Autosaver | None = None):
        self.document: Document | None = None
        self.autosaver = autosaver
        self.usage = Usage()  # local tool-usage counts, shown in the diagnostics report only
        self.last_tool: dict | None = None  # name and outcome of the newest tool run, for diagnostics
        self.import_warnings: list[str] = []
        self.unclean = autosaver.available(unclean_only=True) if autosaver else None  # a dead instance's session, offered until restored
        self._autosave_due = 0  # 1: snapshot wanted, 2: snapshot of a newly opened document

    def _model_summary(self) -> dict:
        """Counts only, for the diagnostics report (no names or geometry)."""
        if self.document is None:
            return {}
        try:
            return {"bodies": len(solids_of(self.document.current.shape))}
        except Exception:
            return {}

    def _autosave(self, fresh: bool = False):
        """Ask for a snapshot; it is queued once the reply is built, so the writer thread does not compete with meshing."""
        if self.autosaver and self.document:
            self._autosave_due = max(self._autosave_due or 0, 2 if fresh else 1)

    def _run_autosave(self):
        due, self._autosave_due = self._autosave_due, 0
        if due and self.autosaver and self.document:
            self.autosaver.save(self.document, due == 2)

    def handle(self, request: dict) -> dict | bytes:
        try:
            return self._handle(request)
        finally:
            self._run_autosave()

    def _require_document(self) -> Document:
        if self.document is None:
            raise RequestError("No document is open")
        return self.document

    def _mesh_reply(self, topology: Topology, timings: dict, **extra) -> bytes:
        start = time.perf_counter()
        ghost = extra.pop("ghost_shape", None)  # a subtracting push/pull preview: the cutting volume outside the bodies
        extra_buffers = None
        if ghost is not None:
            extra["ghost"], extra_buffers = ghost_reply(ghost)
        mesh = tessellate(topology, preview=bool(extra.get("preview")))
        timings["meshMs"] = _ms(start)
        header = {"kind": "mesh", "timings": timings, **extra}
        if self.document is not None:
            header["canUndo"] = self.document.can_undo
            header["canRedo"] = self.document.can_redo
            header["sketches"] = self.document.sketch_list()
            header["datums"] = self.document.datum_list()
            header["mirror"] = self.document.mirror
        return encode_mesh(header, mesh, extra_buffers)

    def _open(self, shape, name: str) -> bytes:
        self.document = Document(shape, name)
        self._autosave(fresh=True)
        return self._mesh_reply(self.document.current, {}, name=name)

    def _handle(self, request: dict) -> dict | bytes:
        kind = request.get("type")
        if kind == "hello":
            return self._hello(request)
        if kind == "resume_session":
            return self._resume_session(request)
        if kind == "restore_session":
            return self._restore_session(request)
        if kind == "open_demo":
            return self._open_demo(request)
        if kind == "new_project":
            return self._new_project(request)
        if kind == "import_step":
            return self._import_step(request)
        if kind == "diagnostics":
            return self._diagnostics(request)
        if kind == "usage_event":
            return self._usage_event(request)
        if kind == "notice_get":
            return self._notice_get(request)
        if kind == "notice_ack":
            return self._notice_ack(request)
        if kind == "usage_clear":
            return self._usage_clear(request)
        if kind == "list_tools":
            return self._list_tools(request)
        if kind == "available_tools":
            return self._available_tools(request)
        if kind == "hole_selection":
            return self._hole_selection(request)
        if kind == "tool_handles":
            return self._tool_handles(request)
        if kind == "measure":
            return self._measure(request)
        if kind == "combine_step":
            return self._combine_step(request)
        if kind == "related":
            return self._related(request)
        if kind == "face_frame":
            return self._face_frame(request)
        if kind == "edge_chain":
            return self._edge_chain(request)
        if kind == "edge_faces":
            return self._edge_faces(request)
        if kind == "edge_selection":
            return self._edge_selection(request)
        if kind == "model_info":
            return self._model_info(request)
        if kind == "sketch_plane" and "faces" in request:
            return self._sketch_on_faces(request)
        if kind == "sketch_plane" and "unwrap" in request:  # a cylinder face unrolled flat to sketch on
            ids = request["unwrap"] if isinstance(request["unwrap"], list) else [request["unwrap"]]
            try:
                topology = self._require_document().current
                unrolling = unwrap.build_unrolling(topology, [int(i) for i in ids])
                return {"plane": unwrap.unwrap_plane(topology.shape, unrolling.reference), "reference": unrolling.reference}
            except (unwrap.UnwrapError, sketch.SketchError) as e:
                raise RequestError(str(e)) from e
        if kind == "sketch_plane":
            plane = self._sketch_plane(request)
            reply = {"plane": plane}
            if "face" in request and not (request.get("offset") or request.get("angle")):  # outline of the face as fixed reference geometry
                reply["reference"] = sketch.face_reference(self._require_document().current.face(int(request["face"])), plane)
            return reply
        if kind == "sketch_solve":
            try:
                result = sketch.solve(request["sketch"], request.get("drag"), bool(request.get("detail")))
            except (KeyError, TypeError, ValueError) as e:
                raise RequestError(f"Malformed sketch: {e!r}") from e
            return result
        if kind == "sketch_flip":
            try:
                return {"sketch": sketch.flip_sketch(request["sketch"])}
            except (KeyError, TypeError, ValueError, sketch.SketchError) as e:
                raise RequestError(f"Malformed sketch: {e!r}") from e
        if kind == "sketch_freedom":
            try:
                return {"freedom": point_freedom_by_part(request["sketch"], budget=1.0), "free_sizes": free_circle_sizes(request["sketch"])}
            except (KeyError, TypeError, ValueError) as e:
                raise RequestError(f"Malformed sketch: {e!r}") from e
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
        if kind == "sketch_profiles":
            content = self._sketch_content(request)
            try:
                return {"profiles": sketch.profile_meshes(content)}
            except (KeyError, TypeError, ValueError, sketch.SketchError) as e:
                raise RequestError(f"Malformed sketch request: {e!r}") from e
            except Exception as e:  # a degenerate curve the modeling kernel refuses (such as a circle of no size): no regions, not a failure
                log.warning("sketch_profiles: %r", e)
                return {"profiles": []}
        if kind == "sketch_keep":
            return self._sketch_keep(request)
        if kind == "sketch_get":
            found = self._require_document().get_sketch(self._sketch_id(request))
            if found is None:
                raise RequestError("No such sketch")
            # the reply's own "id" is the request's correlation id, so the sketch's id travels as sketch_id
            return {"sketch_id": found["id"], "name": found["name"], "rev": found["rev"], "sketch": found["sketch"]}
        if kind in ("sketch_delete", "sketch_rename", "sketch_duplicate"):
            return self._sketch_edit(request, kind)
        if kind == "sketch_move":
            return self._sketch_move(request)
        if kind in ("mirror_set", "mirror_clear"):
            return self._mirror_edit(request, kind)
        if kind in ("datum_add", "datum_rename", "datum_delete", "datum_move"):
            return self._datum_edit(request, kind)
        if kind == "dimension_edit":
            return self._dimension_edit(request)
        if kind in ("tool_preview", "tool_commit"):
            return self._run_tool(request, commit=kind == "tool_commit")
        if kind in ("undo", "redo"):
            return self._undo_redo(request, kind)
        if kind == "rename_body":
            return self._rename_body(request)
        if kind == "set_body_material":
            return self._set_body_material(request)
        if kind == "set_body_locked":
            return self._set_body_locked(request)
        if kind in ("delete_body", "duplicate_body"):
            return self._delete_or_duplicate_body(request, kind)
        if kind == "export_step":
            return self._export_step(request)
        if kind == "export_cad":
            return self._export_cad(request)
        if kind == "save_project":
            return self._save_project(request)
        if kind == "open_project":
            return self._open_project(request)
        if kind == "export_mesh":
            return self._export_mesh(request)
        raise RequestError(f"Unknown request type {kind!r}")


if __name__ == "__main__":
    main()
