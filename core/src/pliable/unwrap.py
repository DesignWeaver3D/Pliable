"""Sketching on unrolled faces.

Some surfaces unroll onto a plane without stretching, so a sketch drawn on the flat result maps back exactly.
Two kinds are supported:

* A cone face unrolls to a circular sector: distance from the apex becomes distance from a point in the
  plane, the angle around the axis is scaled by the sine of the half angle.
* A chain of faces joined along straight edges that all run in one direction (flat faces and cylinders whose
  axis has that direction, like a bent sheet or a block with rounded edges) unrolls to a strip: arc length along
  the cross-section becomes u, the position along the common direction becomes v. A single cylinder face is a
  chain of one.

Closed regions of the sketch are cut into one piece per face of the chain, each piece becomes a face on its own
surface (its outline is the same 2D curves written in that surface's parameter space), and the pieces are
imprinted on the model with the splitter like an ordinary sketch region. A single cylinder or cone is not
clipped, so a region may run across the seam of a full revolution.

Spheres, tori and free-form faces do not unroll without stretching and are refused.
"""

from OCP.GeomAbs import GeomAbs_Cone, GeomAbs_Cylinder, GeomAbs_Line, GeomAbs_Plane  # noqa: F401  (tests reach these through this module)

from .sketch import STANDARD_PLANES
from .tessellate import bounds
from .unwrap_types import CURVE_SAMPLES, TOL, Band, Unrolling, UnwrapError  # noqa: F401
from .unwrap_unrolling import (  # noqa: F401
    GRID,
    OUTLINE_SAMPLES,
    _SURFACE_NAMES,
    _add,
    _dot,
    _edges,
    _common_direction,
    _cone_unrolling,
    _kind,
    _norm,
    _order,
    _parametric_unrolling,
    _scale,
    _shared,
    _strip_unrolling,
    _sub,
    _vertices,
    build_unrolling,
    describe_faces,
    is_flat,
)
from .unwrap_wrap import _anchor, _clip, _pcurve, _wire, wrap_patches, wrap_regions  # noqa: F401


def unwrap_plane(shape=None, reference: dict | None = None) -> dict:
    """The sketch plane the unrolled faces are drawn on: the XY plane, moved sideways to lie beside the model
    (past its largest x, centered on y) so the flat outline does not sit over it. Sketch coordinates stay
    relative to the plane origin, and `wrap_regions` undoes the shift."""
    plane = dict(STANDARD_PLANES["XY"])
    if shape is None or not reference or not reference.get("points"):
        return plane
    xmin, ymin, _, xmax, ymax, _ = bounds(shape)
    reach = max(abs(p["u"]) for p in reference["points"])
    margin = max(10.0, (xmax - xmin) * 0.1)
    plane["origin"] = [round(xmax + margin + reach), round((ymin + ymax) / 2), 0.0]
    return plane
