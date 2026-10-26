"""The Divide face tool."""

import math

from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.TopAbs import TopAbs_FACE
from OCP.TopExp import TopExp_Explorer as _Explorer
from OCP.collections import List_TopoDS_Shape
from OCP.gp import gp_Ax1, gp_Vec

from ..ops import OperationError, OpResult
from ..shared.faces import _PlanarFace, _face_edges, _plane_axes
from ..shared.solids import _bounds_diagonal
from ..tools import Accepts, Handle, Param, register


@register
class DivideFace(_PlanarFace):
    """Add a dividing edge straight across a flat face, parallel to its first (`across` = 0) or second
    (`across` = 1) in-plane axis, `offset` from the face centre, so each side can be moved on its own. `angle` turns the
    line (and the offset direction) about the face normal by that many degrees. With `columns` or `rows` above 1 the
    face is instead divided into an even grid of that many pieces along each (turned) axis, ignoring `offset`."""

    id = "divide_face"
    label = "Divide face"
    description = "Adds a dividing line straight across a flat face so each side can be moved on its own. Select one flat face; across picks the direction (0 or 1), offset the position from the centre and angle turns the line by degrees. Set columns and/or rows above 1 to divide the face into an even grid instead."
    accepts = Accepts(faces=(1, 1))
    params = [Param("across", "number", 0), Param("offset", "length"), Param("angle", "number", 0), Param("columns", "number", 0), Param("rows", "number", 0)]

    @staticmethod
    def _axes(face, angle: float):
        """The face centre, its normal and its two in-plane axes turned by `angle` degrees about the normal."""
        centre, normal, u, v = _plane_axes(face)
        if abs(angle) > 1e-9:
            turn = gp_Ax1(centre, normal)
            u, v = u.Rotated(turn, math.radians(angle)), v.Rotated(turn, math.radians(angle))
        return centre, normal, u, v

    def handles(self, topology, selection, values):
        if self._grid(values) != (1, 1):
            return []
        face = topology.face(selection.faces[0])
        centre, _, u, v = self._axes(face, values.get("angle", 0))
        step = v if int(values["across"]) == 0 else u
        d = values["offset"]
        return [Handle("offset", "Position of the dividing edge", (centre.X() + step.X() * d, centre.Y() + step.Y() * d, centre.Z() + step.Z() * d), (step.X(), step.Y(), step.Z()))]

    @staticmethod
    def _grid(values) -> tuple[int, int]:
        return max(1, int(round(values.get("columns", 0)))), max(1, int(round(values.get("rows", 0))))

    @staticmethod
    def _extent(face, centre, axis) -> tuple[float, float]:
        """The lowest and highest position of the face's outline along `axis`, measured from `centre`."""
        low, high = math.inf, -math.inf
        for edge in _face_edges(face):
            curve = BRepAdaptor_Curve(edge)
            first, last = curve.FirstParameter(), curve.LastParameter()
            for k in range(25):
                p = curve.Value(first + (last - first) * k / 24)
                t = (p.X() - centre.X()) * axis.X() + (p.Y() - centre.Y()) * axis.Y() + (p.Z() - centre.Z()) * axis.Z()
                low, high = min(low, t), max(high, t)
        return low, high

    def run(self, topology, selection, values, preview):
        from OCP.BRepAlgoAPI import BRepAlgoAPI_Splitter
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge

        face = topology.face(selection.faces[0])
        centre, _, u, v = self._axes(face, values.get("angle", 0))
        reach = _bounds_diagonal(face) * 2
        columns, rows = self._grid(values)
        # Each line is (direction it runs along, how far it sits from the centre across it).
        lines = []
        if (columns, rows) == (1, 1):
            along, step = (u, v) if int(values["across"]) == 0 else (v, u)
            lines.append((along, step, values["offset"]))
        else:
            for count, along, step in ((columns, v, u), (rows, u, v)):
                low, high = self._extent(face, centre, step)
                lines += [(along, step, low + (high - low) * k / count) for k in range(1, count)]
        edges = []
        for along, step, distance in lines:
            middle = centre.Translated(gp_Vec(step).Multiplied(distance))
            start = middle.Translated(gp_Vec(along).Multiplied(-reach))
            end = middle.Translated(gp_Vec(along).Multiplied(reach))
            edges.append(BRepBuilderAPI_MakeEdge(start, end).Edge())
        splitter = BRepAlgoAPI_Splitter()
        arguments, tools = List_TopoDS_Shape(), List_TopoDS_Shape()
        arguments.Append(face)
        for line in edges:
            tools.Append(line)
        splitter.SetArguments(arguments)
        splitter.SetTools(tools)
        splitter.Build()
        if not splitter.IsDone() or splitter.Shape().IsNull():
            raise OperationError("Could not divide the face")
        pieces = []
        explorer = _Explorer(splitter.Shape(), TopAbs_FACE)
        while explorer.More():
            pieces.append(explorer.Current())
            explorer.Next()
        if len(pieces) < 2:
            raise OperationError("The dividing edge does not cross the face")
        # Replace the face in the model by its pieces through a second split of the whole shape with the face edges.
        whole = BRepAlgoAPI_Splitter()
        arguments, tools = List_TopoDS_Shape(), List_TopoDS_Shape()
        arguments.Append(topology.shape)
        for piece in pieces:
            tools.Append(piece)
        whole.SetArguments(arguments)
        whole.SetTools(tools)
        whole.SetNonDestructive(True)
        whole.Build()
        if not whole.IsDone() or whole.Shape().IsNull():
            raise OperationError("Could not divide the face")
        return OpResult(whole.Shape(), [], unified=True)  # the split is the point: skip the same-surface merge
