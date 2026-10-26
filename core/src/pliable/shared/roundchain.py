"""Resizing a fillet that runs along a chain of tangent edges (several fillet faces of one radius meeting smoothly)."""

from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepAlgoAPI import BRepAlgoAPI_Defeaturing
from OCP.GeomAbs import GeomAbs_Cylinder, GeomAbs_Sphere, GeomAbs_Torus

from ..ops import MIN_DISTANCE, OperationError, _follow, fillet_chamfer
from ..topology import Topology
from .faces import _face_edges
from .solids import finish


def _round_radius(face) -> float | None:
    """The radius of a cylinder, sphere or torus (its minor radius) face; None for other surfaces."""
    surface = BRepAdaptor_Surface(face)
    kind = surface.GetType()
    if kind == GeomAbs_Cylinder:
        return surface.Cylinder().Radius()
    if kind == GeomAbs_Sphere:
        return surface.Sphere().Radius()
    if kind == GeomAbs_Torus:
        return surface.Torus().MinorRadius()
    return None


def _tangent_neighbours(topology, face):
    from ..measure import _tangent

    found = []
    for edge in _face_edges(face):
        for other in topology.edge_faces(edge):
            if not other.IsSame(face) and _tangent(edge, face, other) and not any(other.IsSame(n) for n in found):
                found.append(other)
    return found


def round_chain(topology, face):
    """The fillet faces tangent-connected to `face` that have its radius, and the faces they roll between (their other tangent neighbours)."""
    radius = _round_radius(face)
    chain = [face]
    if radius is not None:
        todo = [face]
        while todo:
            for other in _tangent_neighbours(topology, todo.pop()):
                other_radius = _round_radius(other)
                if other_radius is not None and abs(other_radius - radius) < 1e-6 and not any(other.IsSame(c) for c in chain):
                    chain.append(other)
                    todo.append(other)
    flats = []
    pairs = []
    for member in chain:
        outside = [n for n in _tangent_neighbours(topology, member) if not any(n.IsSame(c) for c in chain)]
        for n in outside:
            if not any(n.IsSame(f) for f in flats):
                flats.append(n)
        if len(outside) == 2:  # a strip between two faces; a corner patch touches three and is rebuilt with its strips
            pairs.append((outside[0], outside[1]))
    return chain, pairs


def rebuild_chain(topology, face, size: float):
    """Remove every fillet face of the chain, then round the sharp edges they leave with `size` (0 leaves them sharp)."""
    chain, pairs = round_chain(topology, face)
    operation = BRepAlgoAPI_Defeaturing()
    operation.SetShape(topology.shape)
    for member in chain:
        operation.AddFaceToRemove(member)
    operation.SetRunParallel(True)
    operation.Build()
    if not operation.IsDone() or operation.Shape().IsNull():
        raise OperationError("Could not remove this round to resize it")
    sharp = operation.Shape()
    if size < MIN_DISTANCE:
        return finish(sharp)
    rebuilt = Topology(sharp)
    edges = []
    for a, b in pairs:
        fa, fb = _follow(operation.History(), [a]), _follow(operation.History(), [b])
        if len(fa) != 1 or len(fb) != 1:
            raise OperationError("Could not find the sharp edges left by this round")
        shared = [e for _, e in rebuilt.edges() if any(f.IsSame(fa[0]) for f in rebuilt.edge_faces(e)) and any(f.IsSame(fb[0]) for f in rebuilt.edge_faces(e))]
        if not shared:
            raise OperationError("Could not find the sharp edges left by this round")
        edges.extend(e for e in shared if not any(e.IsSame(x) for x in edges))
    return finish(fillet_chamfer(sharp, edges, size).shape)
