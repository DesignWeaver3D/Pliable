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
