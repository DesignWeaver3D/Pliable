"""The Resize chamfer tool."""

from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps

from ..ops import OperationError, planar_normal
from ..shared.faces import _face_edges, _rebuild_round
from ..tools import Accepts, Param, register, Tool


@register
class ResizeChamfer(Tool):
    """Change the size of a chamfer from the chamfer face: it is removed and the sharp edge chamfered again with
    equal legs of the given size (0 leaves the sharp edge)."""

    id = "resize_chamfer"
    label = "Resize chamfer"
    description = "Changes the size of an existing chamfer. Select the chamfer face."
    accepts = Accepts(faces=(1, 1))
    params = [Param("size", "length", 2)]

    def applies(self, topology, selection):
        return planar_normal(topology.face(selection.faces[0])) is not None

    def run(self, topology, selection, values, preview):
        face = topology.face(selection.faces[0])
        edges = list(_face_edges(face))
        if len(edges) != 4:
            raise OperationError("That face is not a simple chamfer (it should have four edges)")

        def length(edge) -> float:
            props = GProp_GProps()
            BRepGProp.LinearProperties_s(edge, props)
            return props.Mass()

        long_edges = sorted(edges, key=length, reverse=True)[:2]
        neighbours = []
        for edge in long_edges:
            others = [f for f in topology.edge_faces(edge) if not f.IsSame(face)]
            if len(others) != 1:
                raise OperationError("That face is not a simple chamfer")
            neighbours.append(others[0])
        return _rebuild_round(topology, face, neighbours, values["size"], chamfer=True)
