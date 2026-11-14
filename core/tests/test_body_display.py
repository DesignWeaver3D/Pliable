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


def test_move_places_the_body_exactly_like_a_transformed_copy():
    from OCP.BRep import BRep_Tool
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform

    from pliable.tools import TOOLS
    from pliable.tools.move_body import turn_and_shift
    from OCP.gp import gp_Pnt, gp_Vec

    topology = Topology(blocks(3))
    values = {"dx": 7.0, "dy": -2.5, "dz": 3.0, "rx": 10.0, "ry": 0.0, "rz": 90.0}
    from pliable.tools import Selection

    result = TOOLS["move_body"].execute(topology, Selection(bodies=[topology.bodies.bodies[1].id]), values, preview=False)
    moved = Topology(result.shape)
    assert (moved.face_count, moved.edge_count, moved.vertex_count) == (topology.face_count, topology.edge_count, topology.vertex_count)
    solid = solids_of(topology.shape)[1]
    centre = gp_Pnt(*[(a + b) / 2 for a, b in zip(*[tuple(x) for x in (_corner(solid, False), _corner(solid, True))])])
    copy = BRepBuilderAPI_Transform(solid, turn_and_shift(centre, gp_Vec(7.0, -2.5, 3.0), [10.0, 0.0, 90.0]), True).Shape()
    expected = Topology(copy)
    found = Topology(solids_of(result.shape)[1])
    assert (found.face_count, found.edge_count, found.vertex_count) == (expected.face_count, expected.edge_count, expected.vertex_count)
    for i in range(expected.vertex_count):
        a, b = BRep_Tool.Pnt_s(found.vertex(i)), BRep_Tool.Pnt_s(expected.vertex(i))
        assert a.Distance(b) < 1e-7
    same(reference(moved), tessellate(moved))


def _corner(solid, high):
    from pliable.tessellate import bounds

    box = bounds(solid)
    return box[3:] if high else box[:3]


def test_edit_after_a_move_and_undo_match_a_fresh_build():
    session = session_of(3)
    body = session.document.current.bodies.bodies[1].id
    session.handle({"type": "tool_commit", "tool": "move_body", "selection": {"bodies": [body]}, "params": {"dx": 7, "rz": 90, "ry": 15}})
    session.handle({"type": "tool_commit", "tool": "move_body", "selection": {"bodies": [body]}, "params": {"dz": 4, "rx": 30}})
    session.handle({"type": "tool_commit", "tool": "push_pull", "selection": {"faces": [top_face(session.document.current)]}, "params": {"distance": 2.0}})
    for request in ("undo", "undo", "undo", "redo", "redo", "redo"):
        session.handle({"type": request})
        current = session.document.current
        cached = tessellate(current)
        same(reference(current), cached)


def test_a_placed_body_survives_save_open_and_step_export():
    import base64

    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps

    def volume(shape):
        props = GProp_GProps()
        BRepGProp.VolumeProperties_s(shape, props)
        return props.Mass()

    session = session_of(3)
    body = session.document.current.bodies.bodies[1].id
    session.handle({"type": "tool_commit", "tool": "move_body", "selection": {"bodies": [body]}, "params": {"dx": 7, "rz": 90, "ry": 15}})
    shape = session.document.current.shape
    saved = session.handle({"type": "save_project"})
    other = Session()
    other.handle({"type": "open_project", "data": saved["data"]})
    reopened = other.document.current
    assert abs(volume(reopened.shape) - volume(shape)) < 1e-6
    same(reference(reopened), tessellate(reopened))
    exported = session.handle({"type": "export_step"})
    third = Session()
    third.handle({"type": "import_step", "name": "x", "data": exported["data"]})
    assert abs(volume(third.document.current.shape) - volume(shape)) < 1e-6
    assert base64.b64decode(exported["data"])
