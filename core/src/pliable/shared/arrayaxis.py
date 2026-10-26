"""The axis a circular array turns about: a global axis through the origin, or the axis of a picked edge."""

from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.GeomAbs import GeomAbs_Circle, GeomAbs_Line
from OCP.gp import gp_Ax1, gp_Dir, gp_Pnt

from ..ops import OperationError

AXIS_CHOICES = ("X axis", "Y axis", "Z axis", "Picked edge")  # the value is the index


def array_axis(topology, values) -> gp_Ax1:
    """The axis for `values["axis"]` (0, 1, 2 = X, Y, Z through the origin; 3 = the line of edge `axis_edge`, or the axis of a circular edge)."""
    choice = int(round(values["axis"]))
    if choice in (0, 1, 2):
        return gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(*(1.0 if k == choice else 0.0 for k in range(3))))
    if choice != 3:
        raise OperationError("The axis must be X, Y, Z or a picked edge")
    index = int(round(values.get("axis_edge", -1)))
    if not 0 <= index < topology.edge_count:
        raise OperationError("Pick an edge for the axis")
    curve = BRepAdaptor_Curve(topology.edge(index))
    kind = curve.GetType()
    if kind == GeomAbs_Line:
        line = curve.Line()
        return gp_Ax1(line.Location(), line.Direction())
    if kind == GeomAbs_Circle:
        return curve.Circle().Axis()
    raise OperationError("Pick a straight or circular edge for the axis")
