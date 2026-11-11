"""A union of bodies that do not touch makes one compound body (a CompSolid holding the solids)."""

import pytest
from build123d import Box, Pos
from OCP.BRep import BRep_Builder
from OCP.TopAbs import TopAbs_COMPSOLID
from OCP.TopoDS import TopoDS_Compound

from pliable.document import Document
from pliable.ops import solids_of
from pliable.tessellate import tessellate
from pliable.tools import Selection, get_tool


def _apart():
    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    for x in (0, 30):
        builder.Add(compound, (Pos(x, 0, 0) * Box(10, 10, 10)).wrapped)
    return compound


def _union(document):
    return get_tool("body_boolean").execute(document.current, Selection(bodies=[1, 2]), {"mode": 0}, preview=False)


def test_union_of_separate_bodies_is_one_compound_body():
    document = Document(_apart())
    assert len(document.current.bodies.bodies) == 2
    document.commit(_union(document).shape)
    assert len(document.current.bodies.bodies) == 1
    (body,) = solids_of(document.current.shape)
    assert body.ShapeType() == TopAbs_COMPSOLID
    mesh = tessellate(document.current)
    assert {f["solid"] for f in mesh.faces} == {0}
    document.undo()
    assert len(document.current.bodies.bodies) == 2
    document.redo()
    assert len(document.current.bodies.bodies) == 1


def test_compound_body_exports_and_keeps_faces_pickable():
    from pliable.files import read_step, write_mesh, write_step

    document = Document(_apart())
    document.commit(_union(document).shape)
    assert len(write_mesh(document.current.shape, "stl")) > 0
    assert len(solids_of(read_step(write_step(document.current.shape)))) == 2
    top = next(i for i, f in document.current.faces() if i is not None)
    result = get_tool("push_pull").execute(document.current, Selection(faces=[top]), {"distance": 2}, preview=False)
    document.commit(result.shape)
    assert len(document.current.bodies.bodies) == 1


def test_union_of_touching_bodies_is_still_one_plain_solid():
    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    for z in (0, 10):
        builder.Add(compound, (Pos(0, 0, z) * Box(10, 10, 10)).wrapped)
    document = Document(compound)
    document.commit(_union(document).shape)
    (body,) = solids_of(document.current.shape)
    assert body.ShapeType() != TopAbs_COMPSOLID


def _overlapping():
    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    for x in (0, 5):
        builder.Add(compound, (Pos(x, 0, 0) * Box(10, 10, 10)).wrapped)
    return compound


@pytest.mark.parametrize("mode, bodies", [(0, 2), (1, 2), (2, 2)])
def test_boolean_keep_tools_leaves_the_tool_body_with_its_id_and_name(mode, bodies):
    document = Document(_overlapping())
    tool_state = document.current.bodies.bodies[1]
    result = get_tool("body_boolean").execute(document.current, Selection(bodies=[1, 2]), {"mode": mode, "keep_tools": 1}, preview=False)
    document.commit(result.shape)
    state = document.current.bodies
    assert len(state.bodies) == bodies
    kept = [b for b in state.bodies if b.id == tool_state.id]
    assert kept and kept[0].name == tool_state.name
    from pliable.ops import solids_of
    from pliable.shared.solids import _volume

    assert any(_volume(s) == pytest.approx(1000, rel=1e-6) for s in solids_of(document.current.shape))


def test_boolean_without_keep_tools_removes_the_tool_body():
    document = Document(_overlapping())
    result = get_tool("body_boolean").execute(document.current, Selection(bodies=[1, 2]), {"mode": 1}, preview=False)
    document.commit(result.shape)
    assert len(document.current.bodies.bodies) == 1
