"""Sketches on a plane with a geometric constraint solver (SolveSpace, via py-slvs).

A sketch is plain JSON, owned by the frontend; the core is stateless: `solve` takes a sketch and returns
the solved coordinates, `profile_face` turns closed loops into a planar face for extrusion.

    {"plane": {"origin": [x, y, z], "normal": [x, y, z], "xdir": [x, y, z]},
     "points": [{"id": 1, "u": 0, "v": 0}],
     "entities": [{"id": 10, "type": "line", "a": 1, "b": 2},
                  {"id": 11, "type": "circle", "center": 3, "radius": 5},
                  {"id": 12, "type": "arc", "center": 4, "start": 5, "end": 6}],   # arcs run counterclockwise
     "constraints": [{"id": 20, "type": "horizontal", "entity": 10},
                     {"id": 21, "type": "distance", "points": [1, 2], "value": 40}]}

Constraint types (arguments in brackets): coincident [points a, b]; point_on [point, entity]; horizontal and
vertical [entity line, or points a, b]; parallel, perpendicular, equal [entities a, b]; angle [entities a, b,
value in degrees]; tangent [entities a, b: arc/line or arc/arc]; distance [points a, b, value] or [entity line,
value]; radius and diameter [entity, value]; fixed [point]; midpoint [point, entity line]; symmetric
[points a, b, entity line]; collinear [entities a, b: lines]; point_line_distance [point, entity line, value]
(always measured as a positive distance, on whichever side the point is now); block [entity: all of its points
(and a circle's radius) stay where they are]; minor_radius [entity ellipse, value: its short semi-axis, which no
other constraint can reach]. A dimension with `"reference": true` is only a measurement and
is not solved.
"""

from build123d import Face  # noqa: F401  (tests reach it as sketch.Face)

from .planes import (
    _cross,
    _quaternion,
    _unit,
    face_plane,
    face_reference,
    frame,
    offset_plane,
    plane_normal_to,
    plane_through,
    rotate_plane,
    shifted_plane,
    STANDARD_PLANES,
    tangent_plane,
)  # noqa: F401
from .flip import (
    flip_plane,
    flip_sketch,
)  # noqa: F401
from .errors import (
    SketchError,
)  # noqa: F401
from .solver import (
    _connected_ids,
    _drag_steps,
    _entity_point_ids,
    _extent,
    _keep_unconnected,
    _solved,
    _Solver,
    apply_solution,
    conflicting_constraints,
    MAX_DRAG_STEP,
    MAX_DRAG_STEPS,
    point_freedom,
    solve,
    SOLVE_GROUP,
)  # noqa: F401
from .profiles import (
    _edges,
    _ellipse_edge,
    _host_face,
    add_regions,
    MIN_LOOP_AREA,
    offset_entities,
    profile_face,
    profile_meshes,
    region_face,
    regions,
)  # noqa: F401
from .operations import (
    _translation,
    extrude,
    revolve,
)  # noqa: F401
