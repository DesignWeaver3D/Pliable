"""A helix wire around an axis, shared by the Helical sweep tool and (later) hole threads."""

import math

from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeWire
from OCP.BRepLib import BRepLib
from OCP.Geom import Geom_CylindricalSurface
from OCP.Geom2d import Geom2d_Line
from OCP.gp import gp_Ax3, gp_Dir, gp_Dir2d, gp_Pnt2d

from ..ops import OperationError


def helix_wire(foot, direction, start, radius, pitch, turns, left=False):
    """The wire of a helix around the axis through `foot` along `direction`: it starts at the point `start` (a vector from `foot`
    to the start, perpendicular to the axis), at `radius`, advances `pitch` per turn for `turns` turns."""
    if radius < 1e-9 or abs(pitch) < 1e-9 or turns < 1e-9:
        raise OperationError("A helix needs a radius, a pitch and a number of turns greater than zero")
    surface = Geom_CylindricalSurface(gp_Ax3(foot, direction, gp_Dir(start)), radius)
    line = Geom2d_Line(gp_Pnt2d(0, 0), gp_Dir2d(2 * math.pi * (-1 if left else 1), pitch))
    edge = BRepBuilderAPI_MakeEdge(line, surface, 0, turns * math.hypot(2 * math.pi, pitch)).Edge()
    BRepLib.BuildCurves3d_s(edge)
    return BRepBuilderAPI_MakeWire(edge).Wire()
