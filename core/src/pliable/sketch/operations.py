"""Turning a sketch into solid: extrude and revolve."""

import math

from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.gp import gp_Dir, gp_Pnt, gp_Vec

from .errors import SketchError
from .planes import frame
from .profiles import profile_face


def extrude(shape, sketch: dict, distance: float, mode: str, symmetric: bool = False):
    """Extrude the sketch's profile along the plane normal and join it to the model (mode "join": positive
    distances go along the normal, so out of a face the sketch sits on) or cut it (mode "cut": into the material)."""
    from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism

    from ..shared.solids import _add_material, _combine, finish

    if mode not in ("join", "cut", "new"):
        raise SketchError("mode must be 'join', 'cut' or 'new'")
    if abs(distance) < 1e-4:
        raise SketchError("Give an extrusion distance")
    face = profile_face(sketch)
    _, _, _, normal = frame(sketch["plane"])
    direction = gp_Vec(*normal)
    if symmetric:
        # Centred on the sketch plane: start half the distance behind it and run the full distance forward.
        start = BRepBuilderAPI_Transform(face.wrapped, _translation(direction.Multiplied(-abs(distance) / 2)), True).Shape()
        prism = BRepPrimAPI_MakePrism(start, direction.Multiplied(abs(distance)))
    elif mode == "cut":
        # Start a hair above the plane so a face lying on the model is cut cleanly.
        margin = 1e-3 + 0.001 * abs(distance)
        lifted = BRepBuilderAPI_Transform(face.wrapped, _translation(direction.Multiplied(margin)), True).Shape()
        prism = BRepPrimAPI_MakePrism(lifted, direction.Multiplied(-(abs(distance) + margin)))
    else:
        prism = BRepPrimAPI_MakePrism(face.wrapped, direction.Multiplied(distance))
    prism.Build()
    if not prism.IsDone():
        raise SketchError("Could not extrude this profile")
    return finish(_combine(shape, prism.Shape(), fuse=True) if mode == "join" else _add_material(shape, prism.Shape(), True) if mode == "new" else _combine(shape, prism.Shape(), fuse=False))


def _translation(vector: gp_Vec):
    from OCP.gp import gp_Trsf

    t = gp_Trsf()
    t.SetTranslation(vector)
    return t


def revolve(shape, sketch: dict, axis_entity: int, angle: float, mode: str):
    """Revolve the sketch's profile about one of its lines (`axis_entity`, which is left out of the profile) and
    join the result to the model (mode "join") or cut it from the model (mode "cut")."""
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeRevol
    from OCP.gp import gp_Ax1

    from ..shared.solids import _add_material, _combine, finish

    if mode not in ("join", "cut", "new"):
        raise SketchError("mode must be 'join', 'cut' or 'new'")
    if not 0.0 < abs(angle) <= 360.0:
        raise SketchError("The angle must be between 0 and 360 degrees")
    line = next((e for e in sketch.get("entities", []) if e["id"] == axis_entity and e["type"] == "line"), None)
    if line is None:
        raise SketchError("Pick a line in the sketch as the axis")
    origin, x, y, normal = frame(sketch["plane"])
    point = {p["id"]: gp_Pnt(*(origin[k] + p["u"] * x[k] + p["v"] * y[k] for k in range(3))) for p in sketch["points"]}
    a, b = point[line["a"]], point[line["b"]]
    if a.Distance(b) < 1e-9:
        raise SketchError("The axis line has zero length")
    face = profile_face(sketch, skip=axis_entity)
    revol = BRepPrimAPI_MakeRevol(face.wrapped, gp_Ax1(a, gp_Dir(gp_Vec(a, b))), math.radians(angle))
    revol.Build()
    if not revol.IsDone():
        raise SketchError("Could not revolve this profile (does it cross the axis?)")
    return finish(_combine(shape, revol.Shape(), fuse=True) if mode == "join" else _add_material(shape, revol.Shape(), True) if mode == "new" else _combine(shape, revol.Shape(), fuse=False))
