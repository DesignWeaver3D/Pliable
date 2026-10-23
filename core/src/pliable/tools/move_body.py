"""The Move/Rotate tool."""

import math

from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.gp import gp_Ax1, gp_Dir, gp_Trsf, gp_Vec

from ..ops import MIN_DISTANCE, OpResult
from ..shared.bodies import _body_bounds, _body_centre, _on_bodies
from ..shared.solids import finish
from ..tools import Accepts, Handle, Param, register, Tool


@register
class MoveBody(Tool):
    """Move and rotate the selected solids (the whole model when nothing is selected): each is first turned about its
    own centre by rx, ry and rz degrees (X, then Y, then Z), then shifted by (dx, dy, dz)."""

    id = "move_body"
    whole_model_needs_one_body = True
    keeps_body_order = True
    label = "Move/Rotate"
    description = (
        "Moves and turns a whole solid in one step. Drag the arrows (or type distances) to move along X, Y and Z, and drag the rings (or type degrees) "
        "to turn about X, Y and Z through the body's centre; the turn is applied first, then the move. Select bodies from the list, any face of the solid, or nothing to move the whole model."
    )
    accepts = Accepts(faces=(0, None), bodies=(0, None))
    params = [Param("dx", "length"), Param("dy", "length"), Param("dz", "length"), Param("rx", "angle"), Param("ry", "angle"), Param("rz", "angle")]
    move_vector = ("dx", "dy", "dz")

    starts_from = "selection"

    def handles(self, topology, selection, values):
        lo, hi = _body_bounds(topology, selection)
        centre = [(a + b) / 2 for a, b in zip(lo, hi)]
        size = max(b - a for a, b in zip(lo, hi))
        margin = max(size * 0.1, 3.0)
        now = (values["dx"], values["dy"], values["dz"])
        axes = ((1, 0, 0), (0, 1, 0), (0, 0, 1))
        reach = [(hi[k] - lo[k]) / 2 + margin for k in range(3)]  # each arrow sticks out past its face of the body
        out = [
            Handle(name, f"Move along {label}", tuple(centre[k] + now[k] + axes[i][k] * reach[i] for k in range(3)), axes[i], kind="move")
            for i, (name, label) in enumerate((("dx", "X"), ("dy", "Y"), ("dz", "Z")))
        ]
        # One ring per axis around the body's (moved) centre; each grip sits 45 degrees round from the axis arrows' directions
        # and turns with the angle, its direction the tangent there, so a drag along it adds degrees (scale = degrees per unit).
        here = [centre[k] + now[k] for k in range(3)]
        radius = max(math.sqrt(sum(((hi[k] - lo[k]) / 2) ** 2 for k in range(3))) * 1.15, 8.0)
        for i, name in enumerate(("rx", "ry", "rz")):
            u, v = (i + 1) % 3, (i + 2) % 3
            theta = math.radians(45 + values[name])
            anchor, tangent = list(here), [0.0, 0.0, 0.0]
            anchor[u], anchor[v] = here[u] + radius * math.cos(theta), here[v] + radius * math.sin(theta)
            tangent[u], tangent[v] = -math.sin(theta), math.cos(theta)
            out.append(Handle(name, f"Rotate about {'XYZ'[i]}", tuple(anchor), tuple(tangent), scale=math.degrees(1 / radius), unit="°", axis=axes[i], ring=(*here, radius)))
        return out

    def run(self, topology, selection, values, preview):
        offset = gp_Vec(values["dx"], values["dy"], values["dz"])
        angles = [values[n] for n in ("rx", "ry", "rz")]
        if offset.Magnitude() < MIN_DISTANCE and all(abs(a) < 1e-9 for a in angles):
            return OpResult(topology.shape, [])
        whole = _body_centre(topology.shape)

        def move_trsf(centre):
            """Turn about `centre` (the body's own, else the whole model's) by rx, ry, rz in that order, then shift."""
            c = centre or whole
            total = gp_Trsf()
            total.SetTranslation(offset)
            for axis_index in (2, 1, 0):  # Multiply puts the later factor first, so this applies X, then Y, then Z
                if abs(angles[axis_index]) < 1e-9:
                    continue
                turn = gp_Trsf()
                turn.SetRotation(gp_Ax1(c, gp_Dir(*(1.0 if k == axis_index else 0.0 for k in range(3)))), math.radians(angles[axis_index]))
                total.Multiply(turn)
            return total

        def change(shape, centre=None):
            return BRepBuilderAPI_Transform(shape, move_trsf(centre), True).Shape()

        record: dict = {}
        result = finish(_on_bodies(topology, selection, change, pivot=True, trsf=move_trsf, record=record, centre_always=True))
        result.moved = record
        return result
