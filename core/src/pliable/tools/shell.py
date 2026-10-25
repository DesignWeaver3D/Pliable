"""The Shell tool."""

from OCP.BRepOffsetAPI import BRepOffsetAPI_MakeThickSolid
from OCP.collections import List_TopoDS_Shape

from ..ops import MIN_DISTANCE, OperationError
from ..shared.solids import _volume, finish, TOL
from ..tools import Accepts, Param, register, Tool


@register
class Shell(Tool):
    """Hollow the solid, leaving the selected faces open; the wall thickness grows inward."""

    id = "shell"
    label = "Shell"
    description = "Hollows out the solid, leaving the selected faces open. Select the faces to open; the wall thickness grows inward."
    accepts = Accepts(faces=(1, None))
    params = [Param("thickness", "length", 2)]

    def run(self, topology, selection, values, preview):
        thickness = values["thickness"]
        if thickness < MIN_DISTANCE:
            raise OperationError("The wall thickness must be positive")
        openings = List_TopoDS_Shape()
        for i in selection.faces:
            openings.Append(topology.face(i))
        maker = BRepOffsetAPI_MakeThickSolid()
        try:
            maker.MakeThickSolidByJoin(topology.shape, openings, -thickness, TOL)
            maker.Build()
        except Exception as e:  # OCCT raises Standard_Failure for walls that do not fit
            raise OperationError(f"Could not shell with this thickness: {e}") from None
        if not maker.IsDone() or maker.Shape().IsNull():
            raise OperationError("Could not shell with this thickness")
        result = finish(maker.Shape())
        if _volume(result.shape) >= _volume(topology.shape) - 1e-6:
            raise OperationError("Could not shell with this thickness (the walls would not fit)")
        return result
