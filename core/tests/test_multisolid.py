import pytest
from build123d import Box, Pos
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.TopoDS import TopoDS_Compound, TopoDS_Shell
from OCP.BRep import BRep_Builder

from pliable.document import Document
from pliable.files import check_import
from pliable.ops import OperationError, planar_normal, solids_of
from pliable.tools import TOOLS, Selection, Tool, get_tool
from pliable.topology import Topology


def volume(shape) -> float:
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return props.Mass()


def two_stacked_boxes():
    a = Box(10, 10, 10).wrapped
    b = Pos(0, 0, 10) * Box(10, 10, 10)  # touches the first box along a face
    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    builder.Add(compound, a)
    builder.Add(compound, b.wrapped)
    return compound


def top_face_of_first_box(topology):
    for i, face in topology.faces():
        normal = planar_normal(face)
        bounds = Bnd_Box()
        BRepBndLib.Add_s(face, bounds)
        if normal is not None and normal.Z() > 0.9 and bounds.CornerMax().Z() == pytest.approx(5):
            return i
    raise AssertionError("face not found")


def test_push_pull_acts_only_on_containing_solid():
    top = Topology(two_stacked_boxes())
    result = get_tool("push_pull").execute(top, Selection(faces=[top_face_of_first_box(top)]), {"distance": -2.0}, preview=False)
    solids = solids_of(result.shape)
    assert len(solids) == 2
    assert sorted(round(volume(s)) for s in solids) == [800, 1000]


def test_unexpected_exception_becomes_readable_message_and_model_unchanged():
    class Standard_NoSuchObject(Exception):
        pass

    class Boom(Tool):
        id, label = "boom", "Boom"
        accepts = TOOLS["push_pull"].accepts

        def run(self, topology, selection, values, preview):
            raise Standard_NoSuchObject("raw OCCT text")

    document = Document(two_stacked_boxes())
    before = document.current.shape
    with pytest.raises(OperationError, match="Boom failed.*missing.*unchanged"):
        Boom().execute(document.current, Selection(faces=[0]), {}, preview=False)
    assert document.current.shape is before and not document.can_undo


def compound_of(*shapes):
    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    for shape in shapes:
        builder.Add(compound, shape)
    return compound


def shell_of(box, skip_faces=0):
    shell, builder = TopoDS_Shell(), BRep_Builder()
    builder.MakeShell(shell)
    for face in box.faces()[: len(box.faces()) - skip_faces]:
        builder.Add(shell, face.wrapped)
    return shell


def test_check_import_clean():
    _, warnings = check_import(two_stacked_boxes())
    assert warnings == []


def test_closed_surface_body_becomes_solid_and_open_one_is_named():
    closed = shell_of(Box(5, 5, 5))
    open_ = shell_of(Pos(20, 0, 0) * Box(5, 5, 5), skip_faces=1)
    shape, warnings = check_import(compound_of(Box(10, 10, 10).wrapped, closed, open_), [(open_, "Lid")])
    assert len(solids_of(shape)) == 2
    assert any("1 surface body closed" in w for w in warnings)
    assert any("1 open surface" in w and "Lid" in w for w in warnings)
    assert "Open body 'Lid': 1 open loop, 1 flat" in warnings


def test_mesh_labels_each_item_with_its_solid():
    from pliable.tessellate import tessellate

    mesh = tessellate(Topology(two_stacked_boxes()))
    assert {f["solid"] for f in mesh.faces} == {0, 1}
    assert {e["solid"] for e in mesh.edges} == {0, 1}
    assert {v["solid"] for v in mesh.vertices} == {0, 1}


def count_solids(shape) -> int:
    return len(solids_of(shape))


@pytest.mark.parametrize(
    "tool,params",
    [
        ("add_box", {}),
        ("add_cylinder", {}),
        ("add_sphere", {}),
        ("add_cone", {"top_diameter": 3}),
        ("add_torus", {}),
    ],
)
def test_primitives_are_separate_bodies_by_default(tool, params):
    block = Topology(Box(20, 20, 20).wrapped)
    placed = {"x": 0, "y": 0, "z": 10, **params}  # overlapping and touching the block
    separate = get_tool(tool).execute(block, Selection(), placed, preview=False)
    assert count_solids(separate.shape) == 2
    joined = get_tool(tool).execute(block, Selection(), {**placed, "new_body": 0}, preview=False)
    assert count_solids(joined.shape) == 1


def test_two_primitives_stay_apart_until_a_boolean_joins_them():
    first = Topology(Box(10, 10, 10).wrapped)
    both = Topology(get_tool("add_box").execute(first, Selection(), {"x": 5, "y": 0, "z": 0}, preview=False).shape)
    assert count_solids(both.shape) == 2
    top = []
    for i, face in both.faces():
        normal = planar_normal(face)
        if normal is not None and normal.Z() > 0.9:
            bounds = Bnd_Box()
            BRepBndLib.Add_s(face, bounds)
            top.append((bounds.CornerMin().X(), i))
    first_top, second_top = min(top)[1], max(top)[1]
    united = get_tool("body_boolean").execute(both, Selection(faces=[first_top, second_top]), {"mode": 0}, preview=False)
    assert count_solids(united.shape) == 1
    assert volume(united.shape) == pytest.approx(2000)


def test_body_list_survives_undo_and_export():
    from pliable.files import read_step, write_mesh, write_step

    document = Document(Box(10, 10, 10).wrapped)
    added = get_tool("add_sphere").execute(document.current, Selection(), {"diameter": 6, "x": 20}, preview=False)
    document.commit(added.shape)
    assert count_solids(document.current.shape) == 2
    assert len(write_mesh(document.current.shape, "stl")) > 0
    assert count_solids(read_step(write_step(document.current.shape))) == 2
    document.undo()
    assert count_solids(document.current.shape) == 1
    document.redo()
    assert count_solids(document.current.shape) == 2


def test_sketch_extrude_new_body_mode():
    from pliable import sketch

    points = [{"id": i + 1, "u": u, "v": v} for i, (u, v) in enumerate([(0, 0), (4, 0), (4, 4), (0, 4)])]
    lines = [{"id": 10 + i, "type": "line", "a": i + 1, "b": (i + 1) % 4 + 1} for i in range(4)]
    plane = {"origin": [0, 0, 5], "x": [1, 0, 0], "y": [0, 1, 0], "normal": [0, 0, 1]}
    block = Box(10, 10, 10).wrapped
    drawn = {"plane": plane, "points": points, "entities": lines, "constraints": []}
    new = sketch.extrude(block, drawn, 3, "new")
    assert count_solids(new.shape) == 2
    assert count_solids(sketch.extrude(block, drawn, 3, "join").shape) == 1


# Per-body move, rotate, scale and offset through the server request path ---------------------------------------


def _two_apart_session():
    from pliable.server import Session

    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    builder.Add(compound, Box(10, 10, 10).wrapped)
    builder.Add(compound, (Pos(30, 0, 0) * Box(10, 10, 10)).wrapped)
    session = Session()
    session.document = Document(compound, "two")
    return session


def _face_at(session, x_min, x_max):
    top = session.document.current
    for i, face in top.faces():
        box = Bnd_Box()
        BRepBndLib.Add_s(face, box)
        if box.CornerMin().X() >= x_min and box.CornerMax().X() <= x_max:
            return i
    raise AssertionError("no face")


def _centres(session):
    out = []
    for solid in solids_of(session.document.current.shape):
        box = Bnd_Box()
        BRepBndLib.Add_s(solid, box)
        out.append(round((box.CornerMin().X() + box.CornerMax().X()) / 2, 3))
    return sorted(out)


def _tool(session, tool, faces, params):
    session.handle({"type": "tool_commit", "tool": tool, "selection": {"faces": faces}, "params": params})


def test_move_body_moves_only_the_selected_body():
    session = _two_apart_session()
    face = _face_at(session, 24, 36)
    _tool(session, "move_body", [face], {"dx": 5})
    assert _centres(session) == [0, 35]
    assert len(solids_of(session.document.current.shape)) == 2


def test_move_body_undo_restores_positions():
    session = _two_apart_session()
    _tool(session, "move_body", [_face_at(session, 24, 36)], {"dx": 5})
    session.handle({"type": "undo"})
    assert _centres(session) == [0.0, 30.0]


def test_group_move_and_whole_model_default():
    session = _two_apart_session()
    faces = [_face_at(session, -6, 6), _face_at(session, 24, 36)]
    _tool(session, "move_body", faces, {"dy": 7})
    assert _centres(session) == [0.0, 30.0]
    boxes = []
    for solid in solids_of(session.document.current.shape):
        box = Bnd_Box()
        BRepBndLib.Add_s(solid, box)
        boxes.append(round(box.CornerMin().Y(), 3))
    assert boxes == [2.0, 2.0]


def test_whole_model_without_selection():
    session = _two_apart_session()
    _tool(session, "move_body", [], {"dx": 1})
    assert _centres(session) == [1.0, 31.0]
    _tool(session, "scale_body", [], {"factor": 2})
    assert _centres(session) == [2.0, 62.0]


def test_scale_rotate_offset_selected_body_only():
    session = _two_apart_session()
    _tool(session, "scale_body", [_face_at(session, 24, 36)], {"factor": 0.5})
    assert len(solids_of(session.document.current.shape)) == 2
    assert sorted(round(volume(s)) for s in solids_of(session.document.current.shape)) == [125, 1000]
    session = _two_apart_session()
    _tool(session, "offset_body", [_face_at(session, 24, 36)], {"distance": 1})
    vols = sorted(round(volume(s)) for s in solids_of(session.document.current.shape))
    assert vols[0] == 1000 and vols[1] > 1000
    session = _two_apart_session()
    _tool(session, "rotate_body", [_face_at(session, 24, 36)], {"axis": 2, "angle": 90})
    assert len(solids_of(session.document.current.shape)) == 2
    assert _centres(session) == [0.0, 0.0]
