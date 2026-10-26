"""Separate length and width resizing for a straight-walled cut (Edit cut): the profile is stretched along one of its
two across axes, so each end moves by the value, the way the all-round resize moves every wall."""

from OCP.BRepBndLib import BRepBndLib
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace, BRepBuilderAPI_Transform
from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism
from OCP.Bnd import Bnd_Box
from OCP.gp import gp_Trsf, gp_Vec

from .ops import MIN_DISTANCE


def _moved(shape, vector: gp_Vec):
    t = gp_Trsf()
    t.SetTranslation(vector)
    return BRepBuilderAPI_Transform(shape, t, True).Shape()


def profile_axes(info):
    """The cut's length and width: ((axis index, low, high), (axis index, low, high)) along the two world axes square to
    the cut, the longer extent first (the lower axis first when equal), or None when the cut does not run along a world axis."""
    across = [i for i in range(3) if abs((info.direction.X(), info.direction.Y(), info.direction.Z())[i]) < 0.5]
    if len(across) != 2:
        return None
    box = Bnd_Box()
    BRepBndLib.Add_s(BRepBuilderAPI_MakeFace(info.wire, True).Face(), box)
    low, high = box.CornerMin(), box.CornerMax()
    spans = [(i, (low.X(), low.Y(), low.Z())[i], (high.X(), high.Y(), high.Z())[i]) for i in across]
    return (spans[1], spans[0]) if spans[1][2] - spans[1][1] > spans[0][2] - spans[0][1] + 1e-6 else (spans[0], spans[1])


def stretch_solid(solid, axis: int, grow: float):
    """The solid with every point of it also moved up to `grow` along a world axis on each side (the cut grows by `grow` at
    both ends); a negative value keeps only what stays inside when moved both ways (the cut shrinks)."""
    if abs(grow) < MIN_DISTANCE:
        return solid
    unit = gp_Vec(*[1.0 if k == axis else 0.0 for k in range(3)])
    if grow > 0:
        return _swept(solid, unit, grow)
    return _shrink(solid, unit, abs(grow))


def _shrink(solid, unit: gp_Vec, keep: float):
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Common

    common = BRepAlgoAPI_Common(_moved(solid, unit.Multiplied(keep)), _moved(solid, unit.Multiplied(-keep)))
    return common.Shape()


def _swept(solid, unit: gp_Vec, grow: float):
    """The solid with every point moved along `unit` by anything from -grow to +grow: both end positions fused with the sweep
    of every face that is not parallel to the direction (a point inside the result is inside an end or lies on a swept wall)."""
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_Plane
    from OCP.TopAbs import TopAbs_FACE
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS

    from .shared.solids import _combine

    result = _combine(_moved(solid, unit.Multiplied(-grow)), _moved(solid, unit.Multiplied(grow)), fuse=True)
    explorer = TopExp_Explorer(solid, TopAbs_FACE)
    while explorer.More():
        face = TopoDS.Face(explorer.Current())
        explorer.Next()
        surface = BRepAdaptor_Surface(face)
        if surface.GetType() == GeomAbs_Plane:
            n = surface.Plane().Axis().Direction()
            if abs(gp_Vec(n).Dot(unit)) < 1e-9:
                continue
        sweep = BRepPrimAPI_MakePrism(_moved(face, unit.Multiplied(-grow)), unit.Multiplied(2 * grow)).Shape()
        result = _combine(result, sweep, fuse=True)
    return result
