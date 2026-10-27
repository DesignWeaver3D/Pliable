"""The Resize fillet tool."""

from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepTools import BRepTools
from OCP.GeomAbs import GeomAbs_Cylinder, GeomAbs_Plane
from OCP.gp import gp_Vec

from ..ops import OperationError
from ..shared.faces import _face_edges, _rebuild_round
from ..tools import Accepts, Handle, Param, register, Tool


@register
class ResizeFillet(Tool):
    """Change the radius of a fillet from the fillet face itself: the round is removed (neighbours extended back
    to a sharp edge) and that edge is filleted again. A radius of 0 leaves the sharp edge. Works on constant and
    variable fillets: an end radius of 0 makes the fillet constant, above 0 makes it variable (radius at the
    edge's first vertex growing or shrinking to the end radius at its last)."""

    id = "resize_fillet"
    label = "Resize fillet"
    description = "Changes the radius of an existing fillet. Select the fillet face (a fillet along a chain of edges is resized as a whole); an end radius of 0 keeps the radius constant."
    accepts = Accepts(faces=(1, 1))
    params = [Param("radius", "length", 2), Param("end_radius", "length", 0)]

    def applies(self, topology, selection):
        # Constant fillets are cylinders or tori; a variable fillet is a free-form surface.
        return BRepAdaptor_Surface(topology.face(selection.faces[0])).GetType() not in (GeomAbs_Plane,)

    def handles(self, topology, selection, values):
        """One grip on the fillet surface's middle that slides toward the fillet's axis, along the bisector of the corner. The
        surface point moves (1 / cos(half the sweep) - 1) units per unit of radius, so the grip follows the typed radius."""
        import math

        surface = BRepAdaptor_Surface(topology.face(selection.faces[0]))
        if surface.GetType() != GeomAbs_Cylinder:
            return []
        u0, u1, v0, v1 = BRepTools.UVBounds_s(topology.face(selection.faces[0]))
        half = (u1 - u0) / 2
        if not 0 < half < math.pi / 2 - 0.05:
            return []
        gain = 1 / math.cos(half) - 1
        cylinder = surface.Cylinder()
        mid = surface.Value((u0 + u1) / 2, (v0 + v1) / 2)
        axis = cylinder.Axis()
        along = gp_Vec(axis.Location(), mid).Dot(gp_Vec(axis.Direction()))
        centre = axis.Location().Translated(gp_Vec(axis.Direction()).Multiplied(along))
        toward = gp_Vec(mid, centre)
        if toward.Magnitude() < 1e-9:
            return []
        toward.Normalize()
        sharp = gp_Vec(mid.X(), mid.Y(), mid.Z()).Subtracted(toward.Multiplied(gain * cylinder.Radius()))  # the sharp corner's line
        d = (toward.X(), toward.Y(), toward.Z())
        reach = gain * values["radius"]
        point = (sharp.X() + d[0] * reach, sharp.Y() + d[1] * reach, sharp.Z() + d[2] * reach)
        return [Handle("radius", "Fillet radius", point, d, scale=1 / gain, min=0.0, kind="resize")]

    def run(self, topology, selection, values, preview):
        from ..measure import _tangent

        face = topology.face(selection.faces[0])
        neighbours = []
        for edge in _face_edges(face):
            for other in topology.edge_faces(edge):
                if not other.IsSame(face) and _tangent(edge, face, other) and not any(other.IsSame(n) for n in neighbours):
                    neighbours.append(other)
        if len(neighbours) != 2:
            # A fillet along a chain of tangent edges: every face of the chain is resized together.
            from ..shared.roundchain import rebuild_chain

            if values["end_radius"] > 0:
                raise OperationError("A variable radius can only be set on a fillet between two faces; leave the end radius at 0")
            return rebuild_chain(topology, face, values["radius"])
        return _rebuild_round(topology, face, neighbours, values["radius"], chamfer=False, end_size=values["end_radius"])
