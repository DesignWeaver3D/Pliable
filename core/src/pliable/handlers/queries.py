"""Session methods for read-only questions about the model: tools on offer, handles, measurements, related faces and edge selections."""

from .. import dimedit
from ..edgesel import edge_loops, edge_ring, outer_loop, face_edges, face_loops, region_boundary, shared_loop, sharp_edges
from ..hole_selection import classify as classify_hole_selection
from ..measure import measure, model_info
from ..ops import OperationError
from ..relations import find_related, tangent_chain
from ..sketch.rail import attach_rail
from ..tools import TOOLS, Selection, get_tool
from .common import RequestError


class QueryHandlers:
    """Session methods for read-only questions about the model: tools on offer, handles, measurements, related faces and edge selections."""

    def _list_tools(self, request):
        return {"tools": [tool.describe() for tool in TOOLS.values()]}

    def _available_tools(self, request):
        topology = self._require_document().current
        selection = Selection.from_json(request.get("selection"))
        attach_rail(self.document, selection, strict=False)
        return {"tools": [t.id for t in TOOLS.values() if t.offered(topology, selection)]}

    def _hole_selection(self, request):
        return classify_hole_selection(self._require_document().current, Selection.from_json(request.get("selection")))

    def _tool_handles(self, request):
        topology = self._require_document().current
        tool = get_tool(str(request.get("tool")))
        selection = Selection.from_json(request.get("selection"))
        attach_rail(self.document, selection, strict=False)
        return {"handles": tool.handle_list(topology, selection, request.get("params") or {}), "startsFrom": tool.starts_from, "anchors": tool.anchor_list(request.get("params") or {})}

    def _measure(self, request):
        topology = self._require_document().current
        try:
            selection = Selection.from_json(request.get("selection"))
            result = measure(topology, selection, request.get("density"), request.get("densities"))
            dimedit.annotate(topology, selection, result)
            return result
        except KeyError as e:
            raise RequestError(e.args[0]) from e

    def _related(self, request):
        topology = self._require_document().current
        try:
            return {"rules": find_related(topology, int(request["face"]))}
        except (KeyError, ValueError, TypeError) as e:
            raise RequestError("Unknown face") from e

    def _face_frame(self, request):
        # Where a flat face sits: its center, normal and the two in-plane axes the Divide face tool measures from.
        from ..shared.faces import _plane_axes
        topology = self._require_document().current
        try:
            centre, normal, u, v = _plane_axes(topology.face(int(request["face"])))
        except (KeyError, ValueError, TypeError) as e:
            raise RequestError("Unknown face") from e
        except OperationError as e:
            raise RequestError(str(e)) from e
        return {"centre": [centre.X(), centre.Y(), centre.Z()], "normal": [normal.X(), normal.Y(), normal.Z()], "u": [u.X(), u.Y(), u.Z()], "v": [v.X(), v.Y(), v.Z()]}

    def _edge_chain(self, request):
        topology = self._require_document().current
        try:
            return {"edges": tangent_chain(topology, int(request["edge"]))}
        except (KeyError, ValueError, TypeError) as e:
            raise RequestError("Unknown edge") from e

    def _edge_faces(self, request):
        topology = self._require_document().current  # the faces beside an edge, for starting a two-distance chamfer from it
        try:
            return {"faces": [topology.face_id(f) for f in topology.edge_faces(topology.edge(int(request["edge"])))]}
        except (KeyError, ValueError, TypeError) as e:
            raise RequestError("Unknown edge") from e

    def _edge_selection(self, request):
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

    def _model_info(self, request):
        try:
            body = int(request["body"]) if request.get("body") is not None else None
            return model_info(self._require_document().current, body)
        except (ValueError, TypeError) as e:
            raise RequestError("Unknown body") from e
