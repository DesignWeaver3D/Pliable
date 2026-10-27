"""The Shell tool."""

from OCP.BRepOffsetAPI import BRepOffsetAPI_MakeThickSolid
from OCP.collections import List_TopoDS_Shape

from ..ops import MIN_DISTANCE, OperationError, planar_normal
from ..shared.solids import _volume, finish, TOL
from ..tools import Accepts, Handle, Param, register, Tool


@register
class Shell(Tool):
    """Hollow the solid, leaving the selected faces open; the wall thickness grows inward."""

    id = "shell"
    label = "Shell"
    description = "Hollows out the solid, leaving the selected faces open. Select the faces to open; the wall thickness grows inward."
    accepts = Accepts(faces=(1, None))
    params = [Param("thickness", "length", 2)]

    def handles(self, topology, selection, values):
        # One grip on the rim of the first opened flat face, sliding into that face: the wall thickness shows as the distance from the rim.
        from build123d import Face

        shape = topology.face(selection.faces[0])
        normal = planar_normal(shape)
        if normal is None:
            return []
        face = Face(shape)
        wire = face.outer_wire()
        p, t = wire.position_at(0.0), wire.tangent_at(0.0)
        n = (normal.X(), normal.Y(), normal.Z())
        side = (n[1] * t.Z - n[2] * t.Y, n[2] * t.X - n[0] * t.Z, n[0] * t.Y - n[1] * t.X)
        length = sum(c * c for c in side) ** 0.5 or 1.0
        side = tuple(c / length for c in side)
        centre = face.center()
        if (centre.X - p.X) * side[0] + (centre.Y - p.Y) * side[1] + (centre.Z - p.Z) * side[2] < 0:
            side = tuple(-c for c in side)
        d = values["thickness"]
        return [Handle("thickness", "Wall thickness", (p.X + side[0] * d, p.Y + side[1] * d, p.Z + side[2] * d), side, min=MIN_DISTANCE)]

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
