"""The Chamfer (distance and angle) tool."""

import math

from ..ops import MIN_DISTANCE, OperationError, edge_curve, planar_normal
from ..shared.faces import _chamfer_with_face
from ..tools import Accepts, Handle, Param, register, Tool


@register
class ChamferDistanceAngle(Tool):
    """Chamfer edges by a distance along the selected reference face and the angle the bevel makes with it."""

    id = "chamfer_distance_angle"
    label = "Chamfer (distance and angle)"
    description = "Bevels edges from a distance and an angle: the bevel starts that distance in from the edge along the selected face and slopes away at the angle to that face (45 degrees gives equal legs, a smaller angle a longer, shallower bevel). Select one face (it sets the side the distance is measured on) and one or more of its edges."
    accepts = Accepts(faces=(1, 1), edges=(1, None))
    params = [Param("distance", "length", 2), Param("angle", "angle", 45)]

    def handles(self, topology, selection, values):
        # On the reference face, in from the first edge's middle: a distance grip, and an angle arc turning about the bevel's start
        # (the arc runs from the face toward the material below it, so a steeper bevel is a larger angle).
        from build123d import Face

        shape = topology.face(selection.faces[0])
        normal = planar_normal(shape)
        if normal is None:
            return []
        at, tangent_at, _ = edge_curve(topology.edge(min(selection.edges)))
        mid, t = at(0.5), tangent_at(0.5)
        n = (normal.X(), normal.Y(), normal.Z())
        side = (n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0])
        length = sum(c * c for c in side) ** 0.5 or 1.0
        side = tuple(c / length for c in side)
        centre = Face(shape).center()
        if sum((c - m) * k for c, m, k in zip((centre.X, centre.Y, centre.Z), mid, side)) < 0:
            side = tuple(-c for c in side)  # into the face, away from the edge
        d = values["distance"]
        start = tuple(m + k * d for m, k in zip(mid, side))
        out = [Handle("distance", "Chamfer distance along the face", start, side, min=MIN_DISTANCE)]
        reach = max(min(d, 6.0), 1.0) * 1.5 if d > 0 else 3.0
        toward = tuple(-k for k in side)  # from the bevel's start back to the edge
        down = tuple(-c for c in n)
        a = math.radians(min(max(values["angle"], 1.0), 89.0))
        point = tuple(s_ + reach * (math.cos(a) * u + math.sin(a) * w) for s_, u, w in zip(start, toward, down))
        grip = tuple(-math.sin(a) * u + math.cos(a) * w for u, w in zip(toward, down))
        axis = (toward[1] * down[2] - toward[2] * down[1], toward[2] * down[0] - toward[0] * down[2], toward[0] * down[1] - toward[1] * down[0])
        out.append(Handle("angle", "Chamfer angle", point, grip, scale=math.degrees(1 / reach), min=1.0, max=89.0, unit="°", axis=axis, ring=(*start, reach), arc=True))
        return out

    def run(self, topology, selection, values, preview):
        if values["distance"] < MIN_DISTANCE or not 0 < values["angle"] < 90:
            raise OperationError("Give a positive distance and an angle between 0 and 90 degrees")
        return _chamfer_with_face(topology, selection, lambda m, e, f: m.AddDA(values["distance"], math.radians(values["angle"]), e, f))
