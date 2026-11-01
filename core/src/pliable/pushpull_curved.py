"""Up to face with a curved target: the pad ends flush on the target's surface (cylinder, cone, sphere or any other face).

The prism-until-face feature of the modeling kernel builds the pad. Its result is only trusted when rays along the pull from
sample points of the profile all reach the target and the pad's volume agrees with those distances; a target that covers only
part of the profile, or that the kernel handles wrongly, is refused with a message and nothing changes.
"""

from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepClass import BRepClass_FaceClassifier
from OCP.BRepFeat import BRepFeat_MakePrism
from OCP.BRepGProp import BRepGProp
from OCP.BRepTools import BRepTools
from OCP.GProp import GProp_GProps
from OCP.IntCurvesFace import IntCurvesFace_ShapeIntersector
from OCP.TopAbs import TopAbs_IN
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Dir, gp_Lin, gp_Pln, gp_Pnt, gp_Pnt2d

from .ops import OperationError, _faces_of, planar_normal, pull_direction
from .opserrors import MIN_DISTANCE

GRID = 11  # sample points per direction across the profile's parameter box
VOLUME_SLACK = 0.1  # the pad's volume may differ this much from the profile area times the sampled distances


def _area(shape) -> float:
    props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(shape, props)
    return props.Mass()


def _volume(shape) -> float:
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return props.Mass()


def profile_samples(face) -> list:
    """Points spread over `face` (the centers of a parameter grid that fall inside it)."""
    adaptor = BRepAdaptor_Surface(face)
    u0, u1, v0, v1 = BRepTools.UVBounds_s(face)
    points = []
    for i in range(GRID):
        for j in range(GRID):
            u = u0 + (u1 - u0) * (i + 0.5) / GRID
            v = v0 + (v1 - v0) * (j + 0.5) / GRID
            if BRepClass_FaceClassifier(face, gp_Pnt2d(u, v), 1e-7).State() == TopAbs_IN:
                points.append(adaptor.Value(u, v))
    return points


def reach_distances(face, pull, target) -> list:
    """The distance along `pull` from each sample point of `face` to the first hit on `target` (None when a ray misses)."""
    finder = IntCurvesFace_ShapeIntersector()
    finder.Load(target, 1e-6)
    result = []
    for point in profile_samples(face):
        finder.PerformNearest(gp_Lin(point, gp_Dir(pull)), MIN_DISTANCE, 1e9)
        result.append(finder.WParameter(1) if finder.NbPnt() > 0 else None)
    return result


def pad_to_curved_face(shape, face, target, direction) -> tuple:
    """(pad solid, its end face on the target) for the planar `face` pulled to the curved `target`. The pad does not include
    `shape`; it only touches it."""
    pull = pull_direction(planar_normal(face), direction)
    reaches = reach_distances(face, pull, target)
    if not reaches:
        raise OperationError("Up to face: could not find the face being pulled")
    if any(r is None for r in reaches):
        raise OperationError("Up to face: the target face does not cover the whole face being pulled, or lies behind it")
    area = _area(face)
    base_plane = BRepBuilderAPI_MakeFace(gp_Pln(BRepAdaptor_Surface(face).Plane().Location(), gp_Dir(planar_normal(face))), -1e5, 1e5, -1e5, 1e5).Face()
    feature = BRepFeat_MakePrism()
    feature.Init(shape, face, base_plane, gp_Dir(pull), 1, False)
    try:
        feature.Perform(target)
    except Exception:
        raise OperationError("Up to face: could not end the pad on the target face") from None
    if not feature.IsDone() or feature.Shape().IsNull() or not BRepCheck_Analyzer(feature.Shape()).IsValid():
        raise OperationError("Up to face: could not end the pad on the target face")
    cut = BRepAlgoAPI_Cut(feature.Shape(), shape)
    pad = cut.Shape() if cut.IsDone() else None
    if pad is None or pad.IsNull() or not (area * min(reaches) * (1 - VOLUME_SLACK) <= _volume(pad) <= area * max(reaches) * (1 + VOLUME_SLACK)):
        raise OperationError("Up to face: could not end the pad on the target face")
    kind = BRepAdaptor_Surface(target).GetType()
    ends = [f for f in map(TopoDS.Face, _faces_of(pad)) if BRepAdaptor_Surface(f).GetType() == kind]
    return pad, max(ends, key=_area, default=None)  # the face of the target's kind (the pad's other faces are flat)
