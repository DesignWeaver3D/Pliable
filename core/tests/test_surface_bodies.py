"""Open shells (surface bodies): bodies of their own, meshed, selectable, with their own id block."""

import numpy as np
from build123d import Box, Pos
from OCP.BRep import BRep_Builder
from OCP.TopoDS import TopoDS_Compound, TopoDS_Shell

from pliable import bodydisplay
from pliable.document import Document
from pliable.files import check_import
from pliable.ops import is_surface, planar_normal, solids_of
from pliable.tessellate import bounds, tessellate, tessellate_whole
from pliable.topology import Topology


def open_shell(box, skip: int = 1):
    """The faces of `box` but the first `skip` ones, as one shell (an open surface body)."""
    shell, builder = TopoDS_Shell(), BRep_Builder()
    builder.MakeShell(shell)
    for face in box.faces()[skip:]:
        builder.Add(shell, face.wrapped)
    return shell


def scene():
    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    builder.Add(compound, Box(10, 10, 10).wrapped)
    builder.Add(compound, open_shell(Pos(30, 0, 0) * Box(10, 10, 10)))
    return compound


def test_open_shell_is_a_surface_body_with_its_own_id_block():
    shape, warnings = check_import(scene())
    assert "1 surface body kept" in warnings
    bodies = solids_of(shape)
    assert [is_surface(b) for b in bodies] == [False, True]
    topology = Topology(shape, bodydisplay_state(shape))
    ranges = bodydisplay.body_ranges(topology, bodies)
    assert ranges is not None  # no fall back to the whole model
    assert ranges[1][1] == 5  # the shell's five faces


def bodydisplay_state(shape):
    from pliable.bodies import fresh

    return fresh(shape)


def test_surface_body_is_named_meshed_and_matches_the_whole_model_path():
    shape, _ = check_import(scene())
    topology = Topology(shape, bodydisplay_state(shape))
    assert [b.name for b in topology.bodies.bodies] == ["Body 1", "Surface 1"]
    mesh = tessellate(topology)
    whole = tessellate_whole(topology)
    assert [b["surface"] for b in mesh.bodies] == [False, True]
    assert all(f["count"] > 0 for f in mesh.faces)  # every face of the shell has triangles
    assert {f["body"] for f in mesh.faces} == {1, 2}
    assert np.array_equal(mesh.indices, whole.indices)
    assert [f["body"] for f in mesh.faces] == [f["body"] for f in whole.faces]


def surface_document():
    shape, _ = check_import(scene())
    return Document(shape, "t", bodydisplay_state(shape))


def test_move_scale_offset_and_unify_work_on_a_surface_body():
    from pliable.tools import Selection, get_tool

    document = surface_document()
    surface_id = document.current.bodies.bodies[1].id
    for tool, values in (("move_body", {"dx": 5.0, "rz": 30.0}), ("scale_body", {"factor": 2.0}), ("offset_body", {"distance": 1.0}), ("unify", {})):
        before = document.current
        result = get_tool(tool).execute(before, Selection(bodies=[surface_id]), values, preview=False)
        document.commit(result.shape, ordered=True)
        bodies = solids_of(document.current.shape)
        assert [is_surface(b) for b in bodies] == [False, True], tool
        assert document.current.bodies.bodies[1].id == surface_id, tool
        mesh = tessellate(document.current)
        assert all(f["count"] > 0 for f in mesh.faces), tool
    assert document.undo()


def test_surface_body_rename_duplicate_and_delete_are_undoable():
    document = surface_document()
    surface_id = document.current.bodies.bodies[1].id
    document.rename_body(surface_id, "Lid")
    topology, copy_id = document.duplicate_body(surface_id)
    assert [b.name for b in topology.bodies.bodies] == ["Body 1", "Lid", "Lid copy"]
    assert [is_surface(b) for b in solids_of(topology.shape)] == [False, True, True]
    document.delete_bodies([surface_id, copy_id])
    assert [is_surface(b) for b in solids_of(document.current.shape)] == [False]
    assert document.undo()
    assert len(solids_of(document.current.shape)) == 3


def test_solid_tool_still_works_beside_a_surface_body():
    from pliable.tools import Selection, get_tool

    document = surface_document()
    topology = document.current
    top = next(i for i, f in topology.faces() if (planar_normal(f) is not None and planar_normal(f).Z() > 0.9 and bounds(f)[5] < 6))
    result = get_tool("push_pull").execute(topology, Selection(faces=[top]), {"distance": 3.0}, preview=False)
    document.commit(result.shape)
    assert [is_surface(b) for b in solids_of(document.current.shape)] == [False, True]
