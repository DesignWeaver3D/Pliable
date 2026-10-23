"""The Inset face edges tool."""

import math

from OCP.collections import List_TopoDS_Shape

from ..ops import face_handle_point, MIN_DISTANCE, OperationError, OpResult, planar_normal
from ..shared.faces import _PlanarFace
from ..tools import Accepts, Handle, Param, register


@register
class InsetFace(_PlanarFace):
    """Offset the edges of a flat face and split the face along them, so the inner region can be pushed, pulled or cut
    on its own. The outer outline moves inward and an inner profile (a hole) grows outward, so the loop stays on the face.
    By default one loop is inset; with `all_loops` set every edge of the face is."""

    id = "inset_face"
    label = "Inset face edges"
    description = "Draws an inner outline on a flat face, a set distance in from its edges, so that inner area can be pushed, pulled or cut on its own. Select one flat face. Set all_loops to 1 to inset the outer perimeter and every inner profile together; otherwise loop picks one (0 is the outer perimeter)."
    accepts = Accepts(faces=(1, 1))
    params = [Param("distance", "length", 2), Param("loop", "number", 0), Param("all_loops", "number", 0)]

    def handles(self, topology, selection, values):
        from build123d import Face

        shape = topology.face(selection.faces[0])
        normal = planar_normal(shape)
        if normal is None:
            return []
        face = Face(shape)
        n = (normal.X(), normal.Y(), normal.Z())
        holes = face.inner_wires()
        loop = int(round(values.get("loop", 0)))
        outer = loop == 0 or values.get("all_loops", 0) >= 0.5
        if not outer and not 0 < loop <= len(holes):
            return []
        wire = face.outer_wire() if outer else holes[loop - 1]
        p, t = wire.position_at(0.0), wire.tangent_at(0.0)
        side = (n[1] * t.Z - n[2] * t.Y, n[2] * t.X - n[0] * t.Z, n[0] * t.Y - n[1] * t.X)
        length = math.sqrt(sum(c * c for c in side)) or 1.0
        side = tuple(c / length for c in side)
        aim = face.center() if outer else Face(wire).center()  # inward for the outline, away from the hole for a hole
        toward = (aim.X - p.X) * side[0] + (aim.Y - p.Y) * side[1] + (aim.Z - p.Z) * side[2]
        if (toward < 0) == outer:
            side = tuple(-c for c in side)
        d = values["distance"]
        centre = face_handle_point(shape)
        return [
            Handle("distance", "Inset distance", (p.X + side[0] * d, p.Y + side[1] * d, p.Z + side[2] * d), side, min=MIN_DISTANCE),
            Handle("all_loops", "Inset every edge, outer and inner (click)", (centre.X(), centre.Y(), centre.Z()), n, toggle=True),
        ]

    def run(self, topology, selection, values, preview):
        from build123d import Face, Kind
        from OCP.BRepAlgoAPI import BRepAlgoAPI_Splitter

        distance = values["distance"]
        if distance < MIN_DISTANCE:
            raise OperationError("The inset distance must be positive")
        face = Face(topology.face(selection.faces[0]))
        loop = int(round(values.get("loop", 0)))
        every = values.get("all_loops", 0) >= 0.5
        holes = face.inner_wires()
        if not every and not 0 <= loop <= len(holes):
            raise OperationError(f"The face has {len(holes)} inner loop(s); loop must be 0 (outline) to {len(holes)}")

        def region_of(wire, grow: bool) -> Face:
            inner = wire.offset_2d(distance if grow else -distance, kind=Kind.INTERSECTION)
            return Face(inner[0] if isinstance(inner, list) else inner)

        regions = []
        try:
            if every or loop == 0:
                outline = region_of(face.outer_wire(), False)
                if outline.area >= face.area:
                    raise OperationError("The inset is larger than the face")
                regions.append(outline)
            if every:
                regions += [region_of(h, True) for h in holes]  # a hole's loop grows outward, so the ring around it becomes its own region
            elif loop > 0:
                regions.append(region_of(holes[loop - 1], True))
        except OperationError:
            raise
        except Exception:
            raise OperationError("The inset is larger than the face") from None
        if any(r.area < MIN_DISTANCE for r in regions):
            raise OperationError("The inset is larger than the face")
        splitter = BRepAlgoAPI_Splitter()
        arguments, tools = List_TopoDS_Shape(), List_TopoDS_Shape()
        arguments.Append(topology.shape)
        for r in regions:
            tools.Append(r.wrapped)
        splitter.SetArguments(arguments)
        splitter.SetTools(tools)
        splitter.SetNonDestructive(True)
        splitter.Build()
        if not splitter.IsDone() or splitter.Shape().IsNull():
            raise OperationError("Could not split the face along the inset")
        return OpResult(splitter.Shape(), [], unified=True)  # the split is the point: skip the same-surface merge
