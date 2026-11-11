"""Up to last and Through all: a pull that adds material from a face or sketch region and needs no target face.

Up to last extends each profile along its pull direction to the last surface of the bodies it reaches, ray by ray, so the
pad ends flush on whatever the farthest body offers there and fills the gaps before it. Through all extends it past every body
in its way and ends on a flat plane at the model's farthest extent in the pull direction. A profile with nothing ahead of it
is refused with a message and nothing changes.
"""

from OCP.Bnd import Bnd_Box
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepLProp import BRepLProp_SLProps
from OCP.BRepTools import BRepTools
from OCP.TopAbs import TopAbs_REVERSED
from OCP.TopoDS import TopoDS
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepGProp import BRepGProp
from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism
from OCP.GProp import GProp_GProps
from OCP.gp import gp_Dir, gp_Pnt, gp_Vec

from .ops import OperationError, _boolean, _faces_of, planar_normal, pull_direction, solids_of
from .opserrors import MIN_DISTANCE
from .pushpull_modes import _prism
from .pushpull_upto import _boundary_points, _clip, assemble_pads

EXTENTS = ("last", "through")
SLIVER = 1e-9  # a piece thinner than this volume is a contact, not material


def _volume(shape) -> float:
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return props.Mass()


def _solid_pieces(shape) -> list:
    return [s for s in solids_of(shape) if _volume(s) > SLIVER]


def _along(point, pull) -> float:
    return point.X() * pull.X() + point.Y() * pull.Y() + point.Z() * pull.Z()


def _exit_faces(solid, pull) -> list:
    """The faces of `solid` that a ray along `pull` leaves it through."""
    result = []
    for face in map(TopoDS.Face, _faces_of(solid)):
        adaptor = BRepAdaptor_Surface(face)
        u0, u1, v0, v1 = BRepTools.UVBounds_s(face)
        u, v = (u0 + u1) / 2, (v0 + v1) / 2
        props = BRepLProp_SLProps(adaptor, u, v, 1, 1e-9)
        if not props.IsNormalDefined():
            continue
        normal = gp_Vec(props.Normal())
        if face.Orientation() == TopAbs_REVERSED:
            normal.Reverse()
        if normal.Dot(pull) > 1e-6:
            result.append(face)
    return result


def _extent(shape, pull) -> tuple:
    """(farthest position along `pull` of the model, its bounding size)."""
    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, box, False, False)
    low, high = box.CornerMin(), box.CornerMax()
    x0, y0, z0, x1, y1, z1 = low.X(), low.Y(), low.Z(), high.X(), high.Y(), high.Z()
    corners = [gp_Pnt(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    return max(_along(c, pull) for c in corners), high.Distance(low)


def pull_to_extent(shape, faces, direction, mode: str, extent: str, flip: bool = False, preview: bool = False, reference=None):
    """Pull `faces` (planar, of a solid or loose sketch regions) up to the last surface ("last") or through all ("through").
    Subtract (or Flip in Auto) cuts the pad from the bodies it meets instead of fusing it.
    `reference`: the shape the pad ends on when it is wider than `shape` (bodies the pad is not fused into or cut from).
    Raises OperationError and changes nothing when nothing lies ahead of a face, or when the pad cannot be built."""
    name = "Up to last" if extent == "last" else "Through all"
    ahead = reference if reference is not None else shape
    bodies = solids_of(ahead)
    if not bodies:
        raise OperationError(f"{name}: there is no body to extend to")
    pads, caps = [], []
    for face in faces:
        if planar_normal(face) is None:
            raise OperationError(f"{name} needs flat faces to pull")
        pull = pull_direction(planar_normal(face), direction)
        start = min(_along(p, pull) for p in _boundary_points(face))
        far, size = _extent(ahead, pull)
        if far - start <= MIN_DISTANCE:
            raise OperationError(f"{name}: nothing lies beyond the face in the pull direction")
        size = 2 * size + 1
        long_prism, _ = _prism(face, pull.Multiplied(size))
        pieces = []
        for body in bodies:  # where the pull meets this body, then the space from which a ray along the pull still leaves it
            hit = BRepAlgoAPI_Common(long_prism, body)
            if not hit.IsDone() or hit.Shape().IsNull():
                continue
            for inside in _solid_pieces(hit.Shape()):
                for exit_face in _exit_faces(inside, pull):
                    sweep = BRepPrimAPI_MakePrism(exit_face, pull.Reversed().Multiplied(size))
                    sweep.Build()
                    common = BRepAlgoAPI_Common(long_prism, sweep.Shape()) if sweep.IsDone() else None
                    if common is not None and common.IsDone() and not common.Shape().IsNull():
                        pieces.extend(_solid_pieces(common.Shape()))
        if not pieces:
            raise OperationError(f"{name}: nothing lies beyond the face in the pull direction" if extent == "last" else "Through all: nothing to extrude through")
        cap = None
        if extent == "last":
            pad = pieces[0]
            for other in pieces[1:]:
                fused = _boolean(pad, other, True, glue=False)
                if fused is None:
                    raise OperationError(f"{name}: could not build the pad")
                pad = fused.Shape()
        else:
            point = _boundary_points(face)[0]
            at = gp_Pnt(*(c + p * (far - _along(point, pull)) for c, p in ((point.X(), pull.X()), (point.Y(), pull.Y()), (point.Z(), pull.Z()))))
            pad, cap = _clip(long_prism, face, at, gp_Dir(pull))
            if cap is None:
                raise OperationError(f"{name}: could not build the pad")
        pads.append(pad)
        caps.append(cap)
    return assemble_pads(shape, faces, pads, caps, mode, flip, preview)
