"""The Chamfer (two distances) tool."""

from OCP.gp import gp_Pnt, gp_Vec

from ..ops import edge_curve, edge_outward_normal, face_handle_point, MIN_DISTANCE, OperationError
from ..shared.faces import _chamfer_with_face
from ..tools import Accepts, Handle, Param, register, Tool


@register
class ChamferTwoDistances(Tool):
    """Chamfer edges with different leg lengths: `first` along the selected reference face, `second` on the other."""

    id = "chamfer_two_distances"
    label = "Chamfer (two distances)"
    description = "Bevels edges with a different distance on each side. Select one face (it sets which side is first) and one or more of its edges."
    accepts = Accepts(faces=(1, 1), edges=(1, None))
    params = [Param("first", "length", 2), Param("second", "length", 1), Param("swap", "number", 0)]  # swap 1 puts `first` on the other side

    def handles(self, topology, selection, values):
        edge = topology.edge(selection.edges[0])
        reference = topology.face(selection.faces[0])
        others = [f for f in topology.edge_faces(edge) if not f.IsSame(reference)]
        normal = edge_outward_normal(topology, edge)
        if not others or normal is None:
            return []
        at, tangent, length = edge_curve(edge)
        mid, along = at(0.5), gp_Vec(*tangent(0.5))

        def into(face):  # unit direction in the face, square to the edge, pointing into the face
            v = gp_Vec(gp_Pnt(*mid), face_handle_point(face))
            v.Subtract(along.Multiplied(v.Dot(along)))
            if v.Magnitude() < 1e-9:
                return None
            v.Normalize()
            return (v.X(), v.Y(), v.Z())

        on_reference, on_other = into(reference), into(others[0])
        if on_reference is None or on_other is None:
            return []
        swapped = values["swap"] >= 0.5
        first_dir, second_dir = (on_other, on_reference) if swapped else (on_reference, on_other)
        point = lambda d, size: tuple(m + x * size for m, x in zip(mid, d))  # noqa: E731
        lift = max(length * 0.1, 1.0)
        return [
            Handle("first", "First distance", point(first_dir, values["first"]), first_dir, min=MIN_DISTANCE),
            Handle("second", "Second distance", point(second_dir, values["second"]), second_dir, min=MIN_DISTANCE),
            Handle("swap", "Swap the two sides (click)", point(normal, lift), tuple(normal), toggle=True),
        ]

    def run(self, topology, selection, values, preview):
        if values["first"] < MIN_DISTANCE or values["second"] < MIN_DISTANCE:
            raise OperationError("Both distances must be positive")
        first, second = (values["second"], values["first"]) if values["swap"] >= 0.5 else (values["first"], values["second"])
        return _chamfer_with_face(topology, selection, lambda m, e, f: m.Add(first, second, e, f))
