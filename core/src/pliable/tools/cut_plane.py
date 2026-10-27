"""The Cut with plane tool."""

from OCP.BRepBndLib import BRepBndLib
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCP.Bnd import Bnd_Box
from OCP.TopoDS import TopoDS_Shape
from OCP.gp import gp_Pnt

from ..ops import OperationError, OpResult, solids_of
from ..shared.planes import _cut_target, _model_middle, _plane_frame, _plane_handles, _plane_normal, _tilted, TILT
from ..shared.solids import _bounds_diagonal, _combine, _compound, _volume
from ..tools import Accepts, Param, register, Tool


SIDE_CHOICES = ("None", "Side 1", "Side 2")  # which part to remove; the value is the index
PLANE_PICK = ("position", "nx", "ny", "nz", "axis")  # filled by the form's Pick plane and datum buttons, which set axis 3 (the direction nx, ny, nz)


def _half_space(shape, normal, position: float, above: bool):
    """A block covering everything past the plane `normal . x = position` (on the normal's side when `above`)."""
    from OCP.gp import gp_Ax2, gp_Dir

    size = 4 * _bounds_diagonal(shape) + 1
    box = Bnd_Box()
    BRepBndLib.Add_s(shape, box)
    centre = gp_Pnt(*[(box.CornerMin().Coord(k + 1) + box.CornerMax().Coord(k + 1)) / 2 for k in range(3)])
    ax = gp_Ax2(centre, gp_Dir(*normal))
    along = sum(normal[k] * centre.Coord(k + 1) for k in range(3))  # how far the model's middle sits along the normal
    start = (position - along) if above else (position - along - size)  # the block's low face, measured from the middle
    corner = gp_Pnt(centre.X() + normal[0] * start - (ax.XDirection().X() + ax.YDirection().X()) * size / 2,
                    centre.Y() + normal[1] * start - (ax.XDirection().Y() + ax.YDirection().Y()) * size / 2,
                    centre.Z() + normal[2] * start - (ax.XDirection().Z() + ax.YDirection().Z()) * size / 2)
    return BRepPrimAPI_MakeBox(gp_Ax2(corner, gp_Dir(*normal), ax.XDirection()), size, size, size).Shape()


def _cutting_plane(shape, values) -> tuple[tuple[float, float, float], float]:
    """The plane's unit normal and its distance from the origin along it. `position` is measured along the untilted
    normal; tilt_u and tilt_v turn the plane about two axes through the point of it nearest the model's middle."""
    base = _plane_normal(values)
    tu, tv = values.get("tilt_u", 0.0), values.get("tilt_v", 0.0)
    if abs(tu) < 1e-9 and abs(tv) < 1e-9:
        return base, values["position"]
    u, v = _plane_frame(base)
    normal = _tilted(_tilted(base, u, tu), v, tv)
    mid = _model_middle(shape)
    pivot = [mid[k] + base[k] * (values["position"] - sum(base[i] * mid[i] for i in range(3))) for k in range(3)]
    return normal, sum(normal[k] * pivot[k] for k in range(3))


def _cut_bodies(topology, selection, values) -> TopoDS_Shape:
    """Cut the chosen bodies (every body when none is chosen) with the plane. `remove_side` +1 drops the part on the normal's side,
    -1 the other part, 0 keeps both parts as separate bodies. Bodies the plane misses stay as they are."""
    side = {0.0: 0.0, 1.0: 1.0, 2.0: -1.0, -1.0: -1.0}.get(values["remove_side"])  # the list gives 0 None, 1 Side 1, 2 Side 2; -1 (the old value for Side 2) still works
    if side is None:
        raise OperationError("Remove side must be None, Side 1 or Side 2")
    chosen, target = _cut_target(topology, selection)
    normal, position = _cutting_plane(target, values)
    out, cut = [], False
    for solid in solids_of(topology.shape):
        if chosen and not any(solid.IsSame(c) for c in chosen):
            out.append(solid)
            continue
        piece = _compound([solid])
        below = _combine(piece, _half_space(target, normal, position, above=True), fuse=False)  # removing the block above leaves the lower part
        above = _combine(piece, _half_space(target, normal, position, above=False), fuse=False)
        vb, va, total = _volume(below), _volume(above), _volume(solid)
        tiny = 1e-9 * max(total, 1)
        if abs(vb + va - total) > 1e-6 * total:  # a cut that leaves nothing reports the whole body: the plane misses it
            middle = _model_middle(solid)
            lower = sum(normal[k] * middle[k] for k in range(3)) < position
            vb, va = (total, 0.0) if lower else (0.0, total)
        if min(vb, va) < tiny:  # the plane misses this body: it is all on one side
            kept = vb if side > 0 else va
            if side != 0 and kept < tiny:
                cut = True  # the whole body is on the removed side
            else:
                out.append(solid)
            continue
        cut = True
        for half in ((below, above) if side == 0 else ((below,) if side > 0 else (above,))):
            out.extend(solids_of(half))
    if side == 0 and not cut:
        raise OperationError("The plane does not pass through the model")
    if not out:
        raise OperationError("The plane would remove the whole model")
    return _compound(out)


@register
class CutPlane(Tool):
    """Cut the model with a plane (square to world axis 0 = X, 1 = Y, 2 = Z, or to the direction nx, ny, nz with
    axis 3) at `position` along its normal. `remove_side` +1 removes the part on the normal's side, -1 the other
    part, 0 keeps both as separate bodies (a split)."""

    id = "cut_plane"
    label = "Cut with plane"
    description = "Cuts the model with a plane and keeps one side or both. Drag the arrow to slide the plane and the two rings to tilt it (tilt_u, tilt_v). Axis 0, 1, 2 is X, Y, Z; axis 3 uses the direction nx, ny, nz. Position is the plane's distance from the origin along its direction. Remove side picks Side 1 (the part on the direction's side), Side 2 (the other part) or None, which keeps both as two separate bodies. Pick plane (a flat face), a datum plane, an origin plane or a sketch button sets the plane from that object. The names of Side 1 and Side 2 take the colours of the bodies they give. Select bodies to cut only those; with nothing selected every body is cut."
    accepts = Accepts(faces=(0, None), bodies=(0, None))
    params = [Param("axis", "number", 2), Param("position", "length"), Param("remove_side", "number", 0, options=SIDE_CHOICES), Param("nx", "number", 0), Param("ny", "number", 0), Param("nz", "number", 1), *TILT]

    pick_plane = PLANE_PICK

    def handles(self, topology, selection, values):
        return _plane_handles(topology, selection, values)

    def run(self, topology, selection, values, preview):
        return OpResult(_cut_bodies(topology, selection, values), [])
