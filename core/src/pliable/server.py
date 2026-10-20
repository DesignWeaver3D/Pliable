"""WebSocket server that exposes the geometry core to the frontend.

Each connection gets its own session with one open document. Requests are
JSON objects with an "id" and a "type"; every request gets exactly one
reply carrying the same id. Replies that include a mesh are binary frames
(see protocol.py), everything else is JSON.
"""

import argparse
import asyncio
import base64
import copy
import json
import logging
import time
from http import HTTPStatus
from pathlib import Path
from urllib.parse import unquote

from websockets.asyncio.server import ServerConnection, serve
from websockets.datastructures import Headers
from websockets.http11 import Response

from . import __version__, sketch, unwrap
from . import bodies as body_ids
from . import dimedit, recipes
from OCP.BRep import BRep_Builder
from OCP.TopoDS import TopoDS_Compound
from . import notice
from .autosave import Autosaver
from .demos import load_demo
from . import diagnostics
from .usage import Usage
from .document import Document
from .features import combine, finish
from .files import part_names, read_step_parts, read_step_tree, write_mesh, write_step
from OCP.gp import gp_Vec
from .measure import measure, model_info
from .ops import OperationError, solids_of
from .protocol import encode_mesh
from .edgesel import edge_loops, edge_ring, outer_loop, face_edges, face_loops, region_boundary, shared_loop, sharp_edges
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
        self.unclean = autosaver.available(unclean_only=True) if autosaver else None  # a dead instance's session, offered until restored

    def _autosave(self, fresh: bool = False):
        if self.autosaver and self.document:
            self.autosaver.save(self.document, fresh)

    def _require_document(self) -> Document:
        if self.document is None:
            raise RequestError("No document is open")
        return self.document

    def _mesh_reply(self, topology: Topology, timings: dict, **extra) -> bytes:
        start = time.perf_counter()
        mesh = tessellate(topology, preview=bool(extra.get("preview")))
        timings["meshMs"] = _ms(start)
        header = {"kind": "mesh", "timings": timings, **extra}
        if self.document is not None:
            header["canUndo"] = self.document.can_undo
            header["canRedo"] = self.document.can_redo
            header["sketches"] = self.document.sketch_list()
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
        if kind == "resume_session":
            document, _parked["document"] = _parked["document"], None
            if document is None:
                raise RequestError("Nothing to resume")
            self.document = document
            self._autosave(fresh=True)
            return self._mesh_reply(document.current, {}, name=document.name)
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
            shape, warnings, named = read_step_parts(base64.b64decode(request["data"]))
            self.document = Document(shape, request.get("name", "Imported"), body_ids.fresh(shape, body_ids.namer(named)))
            self.import_warnings = warnings
            self._autosave(fresh=True)
            return self._mesh_reply(self.document.current, {"importMs": _ms(start)}, name=self.document.name, warnings=warnings, solids=len(solids_of(shape)))
        if kind == "diagnostics":
            return {"report": diagnostics.core_report(self.last_tool, self.import_warnings, self.usage.report())}
        if kind == "usage_event":
            self.usage.record(request.get("tool"), request.get("event"), request.get("surface"))
            return {}
        if kind == "notice_get":
            return {"acknowledged": notice.acknowledged(), "epoch": notice.NOTICE_EPOCH}
        if kind == "notice_ack":
            notice.acknowledge()
            return {"acknowledged": True, "epoch": notice.NOTICE_EPOCH}
        if kind == "usage_clear":
            self.usage.clear()
            return {}
        if kind == "list_tools":
            return {"tools": [tool.describe() for tool in TOOLS.values()]}
        if kind == "available_tools":
            topology = self._require_document().current
            selection = Selection.from_json(request.get("selection"))
            return {"tools": [t.id for t in TOOLS.values() if t.available(topology, selection)]}
        if kind == "tool_handles":
            topology = self._require_document().current
            tool = get_tool(str(request.get("tool")))
            selection = Selection.from_json(request.get("selection"))
            return {"handles": tool.handle_list(topology, selection, request.get("params") or {}), "startsFrom": tool.starts_from, "anchors": tool.anchor_list(request.get("params") or {})}
        if kind == "measure":
            topology = self._require_document().current
            try:
                selection = Selection.from_json(request.get("selection"))
                result = measure(topology, selection)
                dimedit.annotate(topology, selection, result)
                return result
            except KeyError as e:
                raise RequestError(e.args[0]) from e
        if kind == "combine_step":
            document = self._require_document()
            start = time.perf_counter()
            root = read_step_tree(base64.b64decode(request["data"]))
            other, named = root.wrapped, part_names(root)
            offset = gp_Vec(float(request.get("dx", 0)), float(request.get("dy", 0)), float(request.get("dz", 0)))
            result = combine(document.current.shape, other, str(request.get("mode", "union")), offset)
            target = document.commit(result.shape, names=body_ids.namer(named, by_size=True))
            self._autosave()
            return self._mesh_reply(target, {"opMs": _ms(start)}, selection=Selection().to_json())
        if kind == "related":
            topology = self._require_document().current
            try:
                return {"rules": find_related(topology, int(request["face"]))}
            except (KeyError, ValueError, TypeError) as e:
                raise RequestError("Unknown face") from e
        if kind == "face_frame":
            # Where a flat face sits: its centre, normal and the two in-plane axes the Divide face tool measures from.
            from .features import _plane_axes
            topology = self._require_document().current
            try:
                centre, normal, u, v = _plane_axes(topology.face(int(request["face"])))
            except (KeyError, ValueError, TypeError) as e:
                raise RequestError("Unknown face") from e
            except OperationError as e:
                raise RequestError(str(e)) from e
            return {"centre": [centre.X(), centre.Y(), centre.Z()], "normal": [normal.X(), normal.Y(), normal.Z()], "u": [u.X(), u.Y(), u.Z()], "v": [v.X(), v.Y(), v.Z()]}
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
                if mode == "face_outline":
                    return {"edges": outer_loop(topology, int(request["face"]))}
                if mode == "ring":
                    return {"edges": edge_ring(topology, int(request["edge"]))}
                if mode == "edge_loops":
                    return {"edges": edge_loops(topology, int(request["edge"]))}
                if mode == "sharp":
                    return {"edges": sharp_edges(topology, int(request["edge"]), float(request.get("angle", 30)))}
                if mode == "region_boundary":
                    return {"edges": region_boundary(topology, [int(f) for f in request["faces"]])}
                if mode == "shared_loop":
                    return {"edges": shared_loop(topology, int(request["first"]), int(request["second"]))}
            except (KeyError, ValueError, TypeError) as e:
                raise RequestError("Unknown face or edge") from e
            raise RequestError(f"Unknown edge selection mode {mode!r}")
        if kind == "model_info":
            return model_info(self._require_document().current)
        if kind == "sketch_plane" and "faces" in request:
            return self._sketch_on_faces(request)
        if kind == "sketch_plane" and "unwrap" in request:  # a cylinder face unrolled flat to sketch on
            ids = request["unwrap"] if isinstance(request["unwrap"], list) else [request["unwrap"]]
            try:
                topology = self._require_document().current
                unrolling = unwrap.build_unrolling(topology, [int(i) for i in ids])
                return {"plane": unwrap.unwrap_plane(topology.shape, unrolling.reference), "reference": unrolling.reference}
            except unwrap.UnwrapError as e:
                raise RequestError(str(e)) from e
        if kind == "sketch_plane":
            plane = self._sketch_plane(request)
            reply = {"plane": plane}
            if "face" in request:  # outline of the face as fixed reference geometry
                reply["reference"] = sketch.face_reference(self._require_document().current.face(int(request["face"])), plane)
            return reply
        if kind == "sketch_solve":
            try:
                result = sketch.solve(request["sketch"], request.get("drag"), bool(request.get("detail")))
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
        if kind == "sketch_profiles":
            content = self._sketch_content(request)
            try:
                return {"profiles": sketch.profile_meshes(content)}
            except (KeyError, TypeError, ValueError, sketch.SketchError) as e:
                raise RequestError(f"Malformed sketch request: {e!r}") from e
        if kind == "sketch_keep":
            return self._sketch_keep(request)
        if kind == "sketch_get":
            found = self._require_document().get_sketch(self._sketch_id(request))
            if found is None:
                raise RequestError("No such sketch")
            # the reply's own "id" is the request's correlation id, so the sketch's id travels as sketch_id
            return {"sketch_id": found["id"], "name": found["name"], "rev": found["rev"], "sketch": found["sketch"]}
        if kind in ("sketch_delete", "sketch_rename"):
            return self._sketch_edit(request, kind)
        if kind == "dimension_edit":
            return self._dimension_edit(request)
        if kind in ("tool_preview", "tool_commit"):
            return self._run_tool(request, commit=kind == "tool_commit")
        if kind in ("undo", "redo"):
            document = self._require_document()
            changed = document.undo() if kind == "undo" else document.redo()
            if not changed:
                raise RequestError(f"Nothing to {kind}")
            self._autosave()
            return self._mesh_reply(document.current, {})
        if kind == "rename_body":
            document = self._require_document()
            name = str(request.get("name", "")).strip()[:80]
            if not name:
                raise RequestError("A body needs a name")
            try:
                target = document.rename_body(int(request["body"]), name)
            except (KeyError, ValueError, TypeError) as e:
                raise RequestError("Unknown body") from e
            self._autosave()
            return self._mesh_reply(target, {})
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

    def _sketch_on_faces(self, request: dict) -> dict:
        """One entry point for "Sketch On Face": a single flat face gives its plane, anything else (a cylinder or
        cone, a chain of faces) is unrolled flat. A refusal is remembered for the diagnostic report."""
        topology = self._require_document().current
        ids = [int(i) for i in request["faces"]]
        try:
            faces = [topology.face(i) for i in ids]
        except KeyError as e:
            raise RequestError("Unknown face") from e
        if not faces:
            raise RequestError("Select a face to sketch on")
        if len(faces) == 1 and unwrap.is_flat(faces[0]):
            plane = sketch.face_plane(faces[0])
            return {"plane": plane, "reference": sketch.face_reference(faces[0], plane), "unwrapped": False}
        try:
            unrolling = unwrap.build_unrolling(topology, ids)
        except unwrap.UnwrapError as e:
            message = f"{e} ({unwrap.describe_faces(faces)})"
            self.last_tool = {"tool": "sketch_on_face", "commit": False, "ok": False, "error": diagnostics.scrub(message)}
            raise RequestError(message) from e
        self.last_tool = {"tool": "sketch_on_face", "commit": False, "ok": True, "error": None}
        reply = {"plane": unwrap.unwrap_plane(topology.shape, unrolling.reference), "reference": unrolling.reference, "unwrapped": True}
        if unrolling.distortion:
            reply["distortion"] = unrolling.distortion
        return reply

    def _sketch_plane(self, request: dict) -> dict:
        if "plane" in request:
            try:
                return sketch.offset_plane(sketch.STANDARD_PLANES[request["plane"]], float(request.get("offset", 0)))
            except KeyError:
                raise RequestError(f"Unknown plane {request['plane']!r}") from None
            except (TypeError, ValueError) as e:
                raise RequestError(f"Malformed plane request: {e!r}") from e
        topology = self._require_document().current
        if "vertices" in request or "edge" in request or "normal_to" in request:
            return self._sketch_plane_through(topology, request)
        try:
            return sketch.face_plane(topology.face(int(request["face"])))
        except KeyError as e:
            raise RequestError("Unknown face") from e

    def _sketch_plane_through(self, topology, request: dict) -> dict:
        """A plane through three vertices, or through a straight edge and a vertex."""
        from OCP.BRep import BRep_Tool
        from OCP.TopExp import TopExp
        from OCP.TopoDS import TopoDS_Vertex

        def point(vertex):
            p = BRep_Tool.Pnt_s(vertex)
            return (p.X(), p.Y(), p.Z())

        try:
            if "normal_to" in request:  # square to an edge, at a fraction along it (0.5 = the middle)
                from OCP.BRepAdaptor import BRepAdaptor_Curve
                from OCP.gp import gp_Pnt, gp_Vec

                curve = BRepAdaptor_Curve(topology.edge(int(request["normal_to"])))
                first, last = curve.FirstParameter(), curve.LastParameter()
                at = min(1.0, max(0.0, float(request.get("at", 0.5))))
                p, tangent = gp_Pnt(), gp_Vec()
                curve.D1(first + at * (last - first), p, tangent)
                if tangent.Magnitude() < 1e-12:
                    raise RequestError("That edge has no direction at that point")
                return sketch.plane_normal_to((p.X(), p.Y(), p.Z()), (tangent.X(), tangent.Y(), tangent.Z()))
            if "edge" in request:
                v1, v2 = TopoDS_Vertex(), TopoDS_Vertex()
                TopExp.Vertices_s(topology.edge(int(request["edge"])), v1, v2)
                points = [point(v1), point(v2), point(topology.vertex(int(request["vertex"])))]
            else:
                points = [point(topology.vertex(int(i))) for i in request["vertices"]]
                if len(points) != 3:
                    raise RequestError("A plane needs three vertices")
            return sketch.plane_through(*points)
        except sketch.SketchError as e:
            raise RequestError(str(e)) from e
        except (KeyError, TypeError, ValueError) as e:
            raise RequestError(f"Unknown vertex or edge: {e!r}") from e

    def _sketch_project(self, request: dict) -> dict:
        topology = self._require_document().current
        return sketch.face_reference(topology.shape, request["plane"], project=True)

    def _region_shape(self, request: dict):
        """The model shape with the sketch's closed regions added as faces (imprinted or loose)."""
        document = self._require_document()
        try:
            if "unwrap" in request:
                shape, count = unwrap.wrap_regions(document.current.shape, document.current, [int(i) for i in (request["unwrap"] if isinstance(request["unwrap"], list) else [request["unwrap"]])], request["sketch"])
            else:
                shape, count = sketch.add_regions(document.current.shape, request["sketch"])
        except unwrap.UnwrapError as e:
            raise RequestError(str(e)) from e
        except (KeyError, TypeError, ValueError) as e:
            raise RequestError(f"Malformed sketch request: {e!r}") from e
        return shape, count

    def _sketch_regions(self, request: dict) -> bytes:
        """Leave a sketch: its closed regions become faces of the model (imprinted or loose) and stay selected."""
        document = self._require_document()
        start = time.perf_counter()
        shape, _ = self._region_shape(request)
        timings = {"opMs": _ms(start)}
        target = document.commit(shape)
        self._autosave()
        return self._mesh_reply(target, timings, preview=False, selection=Selection().to_json())

    @staticmethod
    def _sketch_id(request: dict) -> int:
        try:
            return int(request["sketch_id"])
        except (KeyError, TypeError, ValueError) as e:
            raise RequestError("Missing sketch id") from e

    def _sketch_content(self, request: dict) -> dict:
        """The sketch a request means: the one it carries, else the stored one named by sketch_id."""
        if isinstance(request.get("sketch"), dict):
            return request["sketch"]
        found = self._require_document().get_sketch(self._sketch_id(request))
        if found is None:
            raise RequestError("No such sketch")
        return found["sketch"]

    def _keep_entries(self, content: dict, request: dict) -> tuple[list, int]:
        """The document's sketch list with `content` stored in it (new, or replacing sketch_id), and its id."""
        document = self._require_document()
        entries = document.sketches
        if request.get("sketch_id") is None:
            sketch_id = document.new_sketch_id()
            name = str(request["name"]) if request.get("name") else f"Sketch {sketch_id}"
            entries.append({"id": sketch_id, "name": name, "rev": 1, "sketch": copy.deepcopy(content)})
        else:
            sketch_id = self._sketch_id(request)
            entry = next((e for e in entries if e["id"] == sketch_id), None)
            if entry is None:
                raise RequestError("No such sketch")
            entry["sketch"] = copy.deepcopy(content)
            entry["rev"] += 1
            if request.get("name"):
                entry["name"] = str(request["name"])
        return entries, sketch_id

    def _sketch_keep(self, request: dict) -> bytes:
        """Store a sketch in the document (new, or replacing `id`), optionally also making its faces, as one undo step."""
        document = self._require_document()
        content = request.get("sketch")
        if not isinstance(content, dict):
            raise RequestError("Missing sketch")
        start = time.perf_counter()
        make_faces = bool(request.get("regions"))
        made = 0
        shape = None
        if make_faces:
            try:
                closed = bool(sketch.regions(content))
            except (KeyError, TypeError, ValueError, sketch.SketchError) as e:
                raise RequestError(f"Malformed sketch request: {e!r}") from e
            if closed:  # an open path (a rail, a curve) is kept as it is and makes no faces
                shape, made = self._region_shape(request)
            else:
                make_faces = False
        timings = {"opMs": _ms(start)}
        entries, sketch_id = self._keep_entries(content, request)
        if make_faces:
            target = document.commit(shape, sketches=entries)
        else:
            target = document.set_sketches(entries)
        self._autosave()
        extra = {"preview": False, "sketchId": sketch_id}
        if bool(request.get("regions")):
            extra["facesMade"] = made
        if make_faces:
            extra["selection"] = Selection().to_json()
        return self._mesh_reply(target, timings, **extra)

    def _sketch_edit(self, request: dict, kind: str) -> bytes:
        document = self._require_document()
        sketch_id = self._sketch_id(request)
        entries = document.sketches
        entry = next((e for e in entries if e["id"] == sketch_id), None)
        if entry is None:
            raise RequestError("No such sketch")
        if kind == "sketch_delete":
            entries.remove(entry)
        else:
            name = str(request.get("name", "")).strip()
            if not name:
                raise RequestError("A sketch needs a name")
            entry["name"] = name
            entry["rev"] += 1
        target = document.set_sketches(entries)
        self._autosave()
        return self._mesh_reply(target, {}, preview=False)

    def _sketch_extrude(self, request: dict) -> bytes:
        document = self._require_document()
        commit = bool(request.get("commit"))
        start = time.perf_counter()
        content = self._sketch_content(request)
        try:
            if "axis" in request:  # revolve about a sketch line instead of extruding
                result = sketch.revolve(document.current.shape, content, int(request["axis"]), float(request["distance"]), str(request.get("mode", "new")))
            else:
                result = sketch.extrude(document.current.shape, content, float(request["distance"]), str(request.get("mode", "new")), bool(request.get("symmetric")))
        except (KeyError, TypeError, ValueError) as e:
            raise RequestError(f"Malformed sketch request: {e!r}") from e
        timings = {"opMs": _ms(start)}
        body_kind = "Revolution" if "axis" in request else "Extrusion"
        extra = {}
        if commit and request.get("keep") and isinstance(request.get("sketch"), dict):  # keep the sketch in the same undo step
            entries, sketch_id = self._keep_entries(content, request)
            target = document.commit(result.shape, body_kind, sketches=entries)
            extra["sketchId"] = sketch_id
        else:
            target = document.commit(result.shape, body_kind) if commit else document.preview(result.shape, body_kind)
        if commit:
            self._autosave()
        return self._mesh_reply(target, timings, preview=not commit, selection=Selection().to_json(), **extra)

    @staticmethod
    def _recipe_change(tool, topology, selection, raw_params: dict, result) -> dict:
        """What the tool did to the primitive recipes of the bodies (see recipes.py): which it combined, moved or created."""
        bodies = topology.bodies.bodies
        change: dict = {"cause": tool.label}
        try:
            values = tool.bind(raw_params)
            combined = tool.combines(topology, selection, values)
        except Exception:
            values, combined = {}, None
        if combined == "all":
            change["combined"] = "all"
        elif combined:
            change["combined"] = {bodies[i].id for i in combined if i < len(bodies)}
        if result.moved:
            change["moved"] = {bodies[i].id: t for i, t in result.moved.items() if i < len(bodies)}
        if tool.starts_from == "tool" and hasattr(tool, "make") and values.get("new_body", 0.0) >= 0.5:
            change["assign"] = {None: {"tool": tool.id, "params": {k: v for k, v in values.items() if isinstance(v, float)}, "m": list(recipes.IDENTITY)}}
        return change

    def _edit_primitive(self, request: dict, tool, commit: bool) -> bytes:
        """Replace one primitive body by the same primitive with new values: it keeps its id, name and place in the list."""
        document = self._require_document()
        topology = document.current
        body_id = int(request["edit_body"])
        index = topology.bodies.find(body_id)
        if index is None:
            raise RequestError("That body no longer exists")
        body = topology.bodies.bodies[index]
        why = recipes.reason(body)
        if why is not None:
            raise RequestError(why)
        if body.recipe["tool"] != tool.id:
            raise RequestError("That body was made by a different tool")
        start = time.perf_counter()
        raw = {**(request.get("params") or {}), "new_body": 1}
        values = tool.bind(raw)
        recipe = recipes.make(tool.id, values, tool.make(values), body.recipe["m"])
        solid = recipes.build(recipe)
        result = finish(solid)
        compound, builder = TopoDS_Compound(), BRep_Builder()
        builder.MakeCompound(compound)
        for n, old in enumerate(solids_of(topology.shape)):
            builder.Add(compound, solids_of(result.shape)[0] if n == index else old)
        timings = {"opMs": _ms(start)}
        change = {"cause": tool.label, "assign": {body_id: {k: recipe[k] for k in ("tool", "params", "m")}}}
        target = document.commit(compound, ordered=True, change=change) if commit else document.preview(compound, ordered=True, change=change)
        if commit:
            self._autosave()
        handles = [] if commit else recipes.transform_handles(tool.handle_list(topology, Selection(), values), recipe)
        return self._mesh_reply(target, timings, preview=not commit, selection=Selection(bodies=[body_id]).to_json(), handles=handles)

    def _dimension_edit(self, request: dict) -> bytes:
        """Set a displayed dimension to a typed value through the matching tool; `commit` false is the live preview."""
        topology = self._require_document().current
        try:
            value = float(request["value"])
            tool, selection, params = dimedit.resolve(topology, Selection.from_json(request.get("selection")), str(request.get("dimension")), value, bool(request.get("flip")))
        except (KeyError, TypeError, ValueError) as e:
            raise RequestError(f"Malformed dimension edit: {e!r}") from e
        return self._run_tool({"tool": tool, "selection": selection, "params": params}, commit=bool(request.get("commit")))

    def _run_tool(self, request: dict, commit: bool) -> bytes:
        document = self._require_document()
        topology = document.current
        tool = get_tool(str(request.get("tool")))
        if request.get("edit_body") is not None:
            return self._edit_primitive(request, tool, commit)
        selection = request_selection = Selection.from_json(request.get("selection"))
        start = time.perf_counter()
        self.last_tool = {"tool": tool.id, "commit": commit, "ok": False, "error": None}
        try:
            result = tool.execute(topology, selection, request.get("params") or {}, preview=not commit)
        except Exception as e:
            self.last_tool["error"] = diagnostics.scrub(f"{type(e).__name__}: {e}")
            raise
        self.last_tool["ok"] = True
        timings = {"opMs": _ms(start)}
        body_kind, ordered = tool.body_kind, tool.keeps_body_order
        change = self._recipe_change(tool, topology, selection, request.get("params") or {}, result)
        target = document.commit(result.shape, body_kind, ordered, change=change) if commit else document.preview(result.shape, body_kind, ordered, change=change)
        if commit:
            self._autosave()
        faces = [i for f in result.tracked_faces if (i := target.face_id(f)) is not None]
        edges = [i for e in result.tracked_edges if (i := target.edge_id(e)) is not None]
        vertices = [i for v in result.tracked_vertices if (i := target.vertex_id(v)) is not None]
        kept = {b.id for b in target.bodies.bodies}
        selection = Selection(faces=faces, edges=edges, vertices=vertices, bodies=[b for b in request_selection.bodies if b in kept])
        handles = [] if commit else tool.handle_list(topology, request_selection, request.get("params") or {})
        return self._mesh_reply(target, timings, preview=not commit, selection=selection.to_json(), handles=handles)


# The document of the connection that dropped last, kept so the page can pick it up again after reconnecting.
_parked: dict = {"document": None}


async def _handle_connection(connection: ServerConnection, autosaver: Autosaver | None = None):
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
    asyncio.run(run(args.host, args.port))


if __name__ == "__main__":
    main()
