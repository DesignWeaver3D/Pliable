"""The Array along path tool."""

from OCP.gp import gp_Trsf, gp_Vec

from ..ops import OperationError
from ..shared.arrays import _array_copies, _fuse_copies
from ..tools import Accepts, Param, register, Tool


@register
class PathArray(Tool):
    """Copies of the chosen body (the whole model when no face is selected) placed at equal distances along a path of one or more connected edges, starting
    at the model's current position (the first copy is the original); copies are moved, not turned, and fused
    with it. On a closed path the copies are spread round it without doubling up at the start."""

    id = "path_array"
    label = "Array along path"
    description = "Needs an edge selected (it does not show in the tool strip otherwise). Places copies of a body at equal distances along connected edges. Select the edges that form the path, plus any face of the body to copy (none copies the whole model), or the round walls of holes or bosses to copy just those features; the count includes the original."
    accepts = Accepts(faces=(0, None), edges=(1, None))
    params = [Param("count", "number", 4)]

    def run(self, topology, selection, values, preview):
        from OCP.BRepAdaptor import BRepAdaptor_CompCurve
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeWire
        from OCP.GCPnts import GCPnts_AbscissaPoint

        count = _array_copies(values["count"])
        maker = BRepBuilderAPI_MakeWire()
        for i in selection.edges:
            maker.Add(topology.edge(i))
        if not maker.IsDone():
            raise OperationError("The selected edges do not form one connected path")
        wire = maker.Wire()
        curve = BRepAdaptor_CompCurve(wire)
        total = GCPnts_AbscissaPoint.Length_s(curve)
        closed = curve.IsClosed()
        steps = count if closed else count - 1
        start = curve.Value(curve.FirstParameter())
        transforms = []
        for k in range(1, count):
            locator = GCPnts_AbscissaPoint(curve, total * k / steps, curve.FirstParameter())
            if not locator.IsDone():
                raise OperationError("Could not place the copies along this path")
            trsf = gp_Trsf()
            trsf.SetTranslation(gp_Vec(start, curve.Value(locator.Parameter())))
            transforms.append(trsf)
        return _fuse_copies(topology, selection, transforms)
