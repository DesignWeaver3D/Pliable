"""Session methods that run a tool, edit a primitive or a dimension, and report recipe changes."""

import time

from OCP.BRep import BRep_Builder
from OCP.TopoDS import TopoDS_Compound

from .. import diagnostics, dimedit, recipes
from ..measure import measure
from ..mirrormode import mirror_result
from ..plane_sides import side_bodies
from ..ops import solids_of
from ..shared.solids import finish
from ..tools import get_tool, Selection
from ..topology import Topology
from .common import _ms, RequestError


class ToolHandlers:
    """Session methods that run a tool, edit a primitive or a dimension, and report recipe changes."""

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
        topology.datums = document.datum_list()  # for tools that work about a datum plane (symmetric push/pull)
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
        if document.mirror and not result.moved:
            result = mirror_result(topology.shape, result, document.mirror["plane"])
        timings = {"opMs": _ms(start)}
        body_kind, ordered = tool.body_kind, tool.keeps_body_order
        change = self._recipe_change(tool, topology, selection, request.get("params") or {}, result)
        target = document.commit(result.shape, body_kind, ordered, change=change) if commit else document.preview(result.shape, body_kind, ordered, change=change)
        if commit:
            if request.get("foldPick"):  # extruding a just-picked sketch region: its pick is not a step of its own
                document.fold_previous_step()
            self._autosave()
        faces = [i for f in result.tracked_faces if (i := target.face_id(f)) is not None]
        edges = [i for e in result.tracked_edges if (i := target.edge_id(e)) is not None]
        vertices = [i for v in result.tracked_vertices if (i := target.vertex_id(v)) is not None]
        kept = {b.id for b in target.bodies.bodies}
        selection = Selection(faces=faces, edges=edges, vertices=vertices, bodies=[b for b in request_selection.bodies if b in kept])
        handles = [] if commit else tool.handle_list(topology, request_selection, request.get("params") or {})
        extra = {}
        if not commit:
            dimensions = self._preview_dimensions(request_selection, selection, target)
            if dimensions is not None:
                extra["dimensions"] = dimensions
            if tool.id == "cut_plane":
                extra["sides"] = side_bodies(document, topology, request_selection, request.get("params") or {}, change)  # the form colours Side 1 and Side 2 like these bodies
        return self._mesh_reply(target, timings, preview=not commit, selection=selection.to_json(), handles=handles, **extra)

    @staticmethod
    def _preview_dimensions(asked: Selection, mapped: Selection, target: Topology) -> list | None:
        """The measurement dimensions of the one face or edge a preview keeps selected (a hole being moved), measured on
        the previewed model so they follow the change. None when the selection is not a single face or edge."""
        if len(asked.faces) + len(asked.edges) != 1 or asked.vertices or len(mapped.faces) + len(mapped.edges) != 1:
            return None
        try:
            return measure(target, Selection(faces=mapped.faces, edges=mapped.edges))["dimensions"]
        except Exception:  # a failed measurement only leaves the old dimensions in place
            return None
