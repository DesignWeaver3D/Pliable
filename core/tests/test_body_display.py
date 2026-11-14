"""The per-body display cache must give exactly what a whole-model tessellation gives."""

from build123d import Box, Compound, Cylinder, Face, Pos
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepTools import BRepTools

from pliable.document import Document
from pliable.ops import planar_normal, solids_of
from pliable.server import Session
from pliable.tessellate import body_cache, display_cache, tessellate, tessellate_whole
from pliable.topology import Topology


def blocks(n):
    return Compound([Pos(i * 30, 0, 0) * (Box(20, 20, 10) - Cylinder(3, 20)) for i in range(n)]).wrapped


def same(a, b):
    for name in ("positions", "normals", "indices", "edge_positions"):
        x, y = getattr(a, name), getattr(b, name)
        assert x.dtype == y.dtype and x.shape == y.shape and x.tobytes() == y.tobytes(), name
    for name in ("faces", "edges", "vertices", "centres", "bodies", "bounds"):
        assert getattr(a, name) == getattr(b, name), name


def reference(topology, preview=False):
    display_cache.clear()
    return tessellate_whole(topology, preview)


def top_face(topology):
    return next(i for i, f in topology.faces() if (n := planar_normal(f)) is not None and n.Z() > 0.999)


def session_of(n):
    session = Session()
    session.document = Document(blocks(n), "t")
    return session


def test_per_body_mesh_equals_the_whole_model_mesh():
    topology = Topology(blocks(5))
    for preview in (False, True):
        expected = reference(topology, preview)
        same(expected, tessellate(topology, preview))  # built
        hits = body_cache.hits
        same(expected, tessellate(topology, preview))  # reused
        assert body_cache.hits - hits == 5


def test_one_body_move_rebuilds_only_that_body():
    session = session_of(6)
    tessellate(session.document.current)
    body = session.document.current.bodies.bodies[2].id
    hits = body_cache.hits
    session.handle({"type": "tool_commit", "tool": "move_body", "selection": {"bodies": [body]}, "params": {"dx": 7, "rz": 90}})
    assert body_cache.hits - hits == 5  # every other body came from the cache, the moved one was rebuilt
    current = session.document.current
    cached = tessellate(current)
    same(reference(current), cached)


def test_undo_and_redo_match_a_fresh_build():
    session = session_of(4)
    body = session.document.current.bodies.bodies[1].id
    session.handle({"type": "tool_commit", "tool": "move_body", "selection": {"bodies": [body]}, "params": {"dx": 7}})
    session.handle({"type": "tool_commit", "tool": "push_pull", "selection": {"faces": [top_face(session.document.current)]}, "params": {"distance": 2.0}})
    for request in ("undo", "undo", "redo", "redo"):
        session.handle({"type": request})
        current = session.document.current
        cached = tessellate(current)
        same(reference(current), cached)


def test_a_finer_mesh_made_behind_the_cache_is_not_reused():
    topology = Topology(blocks(2))
    tessellate(topology)
    solid = solids_of(topology.shape)[0]
    BRepTools.Clean_s(solid)
    BRepMesh_IncrementalMesh(solid, 0.01, False, 0.2, True)
    display_cache.entries.clear()  # only the body-level guard is under test
    display_cache.weight = 0
    cached = tessellate(topology)
    same(reference(topology), cached)


def test_models_whose_ids_are_not_one_block_per_body_take_the_whole_path():
    box = Box(10, 10, 10)
    shapes = {
        "loose face beside solids": Compound([box, Face.make_rect(5, 5), Pos(30, 0, 0) * box]).wrapped,
        "only a face": Face.make_rect(5, 5).wrapped,
    }
    for name, shape in shapes.items():
        topology = Topology(shape)
        same(reference(topology), tessellate(topology))
