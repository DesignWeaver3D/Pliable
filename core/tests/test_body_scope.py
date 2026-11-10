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
