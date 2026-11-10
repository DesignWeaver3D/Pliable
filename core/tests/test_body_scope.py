"""A tool that declares scope_to_bodies sees only the bodies its selection belongs to (body_scope.py)."""

import pytest
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps

from pliable.demos import load_demo
from pliable.document import Document
from pliable.ops import planar_normal, solids_of
from pliable.tools import Selection, get_tool


def volume(shape) -> float:
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return props.Mass()


def top_face_of(topology, body_index):
    """The face with the highest +Z normal plane among the faces of one body (the copy has the same faces, so pick by body)."""
    from OCP.TopAbs import TopAbs_FACE
    from OCP.TopExp import TopExp
    from OCP.collections import IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher as ShapeIndexedMap

    mine = ShapeIndexedMap()
    TopExp.MapShapes_s(solids_of(topology.shape)[body_index], TopAbs_FACE, mine)
    best = None
    for i, face in topology.faces():
        normal = planar_normal(face)
        if mine.Contains(face) and normal is not None and normal.Z() > 0.9:
            best = i
    return best


@pytest.fixture
def block_with_copy():
    document = Document(load_demo("block"))
    document.duplicate_body(document.current.bodies.bodies[0].id)
    return document.current


@pytest.mark.parametrize("body_index", [0, 1])
def test_shell_works_on_a_body_that_has_a_copy_on_top_of_it(block_with_copy, body_index):
    scene = block_with_copy
    before = volume(scene.shape)
    face = top_face_of(scene, body_index)
    result = get_tool("shell").execute(scene, Selection(faces=[face]), {"thickness": 2}, preview=False)
    solids = solids_of(result.shape)
    assert len(solids) == 2
    walls = 24000 - 36 * 26 * 18  # the block is 40 x 30 x 20; a 2 wall leaves this much material
    assert volume(result.shape) == pytest.approx(before - 24000 + walls, rel=1e-4)
    assert volume(solids[1 - body_index]) == pytest.approx(24000, rel=1e-6)  # the other body is untouched
    assert volume(solids[body_index]) == pytest.approx(walls, rel=1e-4)


def first_of_body(topology, body_index, kind):
    """Scene id of the first face or edge (by id) that belongs to one body."""
    from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE
    from OCP.TopExp import TopExp
    from OCP.collections import IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher as ShapeIndexedMap

    mine = ShapeIndexedMap()
    TopExp.MapShapes_s(solids_of(topology.shape)[body_index], TopAbs_FACE if kind == "faces" else TopAbs_EDGE, mine)
    items = topology.faces() if kind == "faces" else topology.edges()
    return next(i for i, shape in items if mine.Contains(shape))


# (tool, what it is given, extra values) for the tools that work on the body owning the selection
SCOPED = [
    ("fillet_chamfer", "edges", {"distance": 2}),
    ("round_face", "faces", {"distance": 2}),
    ("divide_face", "faces", {}),
    ("inset_face", "faces", {}),
]


def _selection(kind, index):
    return Selection(**{kind: [index]})


def _params(tool, extra):
    return {p.name: p.default for p in tool.params} | extra


@pytest.mark.parametrize("body_index", [0, 1])
@pytest.mark.parametrize("tool_id,kind,extra", SCOPED)
def test_scoped_tools_ignore_a_copy_lying_on_the_body(block_with_copy, tool_id, kind, extra, body_index):
    from pliable.topology import Topology

    tool = get_tool(tool_id)
    assert tool.scope_to_bodies
    lone = Topology(solids_of(block_with_copy.shape)[0])
    alone = tool.execute(lone, _selection(kind, first_of_body(block_with_copy, 0, kind)), _params(tool, extra), preview=False)
    with_copy = tool.execute(block_with_copy, _selection(kind, first_of_body(block_with_copy, body_index, kind)), _params(tool, extra), preview=False)
    solids = solids_of(with_copy.shape)
    assert len(solids) == 2
    assert volume(solids[body_index]) == pytest.approx(volume(alone.shape), rel=1e-6)
    assert volume(solids[1 - body_index]) == pytest.approx(24000, rel=1e-6)
