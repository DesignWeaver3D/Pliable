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
