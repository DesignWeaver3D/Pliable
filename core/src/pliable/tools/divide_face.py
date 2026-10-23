"""The Divide face tool."""

from OCP.TopAbs import TopAbs_FACE
from OCP.TopExp import TopExp_Explorer as _Explorer
from OCP.collections import List_TopoDS_Shape
from OCP.gp import gp_Vec

from ..ops import OperationError, OpResult
from ..shared.faces import _PlanarFace, _plane_axes
from ..shared.solids import _bounds_diagonal
from ..tools import Accepts, Param, register


@register
class DivideFace(_PlanarFace):
    """Add a dividing edge straight across a flat face, parallel to its first (`across` = 0) or second
    (`across` = 1) in-plane axis, `offset` from the face centre, so each side can be moved on its own."""

    id = "divide_face"
    label = "Divide face"
    description = "Adds a dividing line straight across a flat face so each side can be moved on its own. Select one flat face; across picks the direction (0 or 1) and offset the position from the centre."
    accepts = Accepts(faces=(1, 1))
    params = [Param("across", "number", 0), Param("offset", "length")]

    def run(self, topology, selection, values, preview):
        from OCP.BRepAlgoAPI import BRepAlgoAPI_Splitter
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge

        face = topology.face(selection.faces[0])
        centre, _, u, v = _plane_axes(face)
        along, step = (u, v) if int(values["across"]) == 0 else (v, u)
        reach = _bounds_diagonal(face) * 2
        middle = centre.Translated(gp_Vec(step).Multiplied(values["offset"]))
        start = middle.Translated(gp_Vec(along).Multiplied(-reach))
        end = middle.Translated(gp_Vec(along).Multiplied(reach))
        line = BRepBuilderAPI_MakeEdge(start, end).Edge()
        splitter = BRepAlgoAPI_Splitter()
        arguments, tools = List_TopoDS_Shape(), List_TopoDS_Shape()
        arguments.Append(face)
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
