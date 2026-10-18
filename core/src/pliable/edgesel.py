"""Edge selection helpers: the edges around a face, its boundary loops, and the loop two edges share."""

from OCP.TopAbs import TopAbs_EDGE, TopAbs_WIRE
from OCP.TopExp import TopExp_Explorer

from .ops import OperationError
from .topology import Topology


def _edge_ids(topology: Topology, shape) -> list[int]:
    explorer, ids = TopExp_Explorer(shape, TopAbs_EDGE), []
    while explorer.More():
        i = topology.edge_id(explorer.Current())
        if i is not None and i not in ids:
            ids.append(i)
        explorer.Next()
    return ids


def face_loops(topology: Topology, face_id: int) -> list[list[int]]:
    """The edge ids of each boundary loop of a face: the outer loop first, then any hole loops."""
    face = topology.face(face_id)
    explorer, loops = TopExp_Explorer(face, TopAbs_WIRE), []
    while explorer.More():
        loops.append(_edge_ids(topology, explorer.Current()))
        explorer.Next()
    return loops


def face_edges(topology: Topology, face_id: int) -> list[int]:
    return _edge_ids(topology, topology.face(face_id))


def shared_loop(topology: Topology, first: int, second: int) -> list[int]:
    """The boundary loop of a face that both edges border (the one holding `second` if there are several)."""
    if first == second:
        raise OperationError("Select two different edges")
    faces_a = {topology.face_id(f) for f in topology.edge_faces(topology.edge(first))}
    faces_b = [topology.face_id(f) for f in topology.edge_faces(topology.edge(second))]
    shared = [f for f in faces_b if f in faces_a]
    if not shared:
        raise OperationError("These two edges do not border a common face")
    best: list[int] | None = None
    for face_id in shared:
        for loop in face_loops(topology, face_id):
            if second in loop:
                if first in loop:
                    return loop
                best = best or loop
    return best or []
