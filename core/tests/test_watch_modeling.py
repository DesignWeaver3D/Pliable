"""Corners from docs/watchlist.md pinned through the real code paths: edit-last ids, degenerate shell/draft/defeature input,
clashing fillet radii, the array copy cap and a patch fill followed by a fillet."""

import pytest
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps

from pliable.demos import load_demo
from pliable.ops import OperationError, planar_normal, solids_of
from pliable.protocol import decode_binary
from pliable.server import Session
from pliable.tools import Selection, get_tool
from pliable.topology import Topology


def volume(shape) -> float:
    total = 0.0
    for solid in solids_of(shape):
        props = GProp_GProps()
        BRepGProp.VolumeProperties_s(solid, props)
        total += props.Mass()
    return total


def block_face(topology, nx, ny, nz):
    for i, f in topology.faces():
        n = planar_normal(f)
        if n is not None and (round(n.X()), round(n.Y()), round(n.Z())) == (nx, ny, nz):
            return i
    raise AssertionError("no such face")


def execute(shape, tool, faces=(), edges=(), preview=False, **params):
    topology = Topology(shape)
    return get_tool(tool).execute(topology, Selection(faces=list(faces), edges=list(edges)), params, preview=preview)


def send(session, kind, **fields):
    return decode_binary(session.handle({"type": kind, **fields}))[0]


@pytest.fixture
def block():
    return load_demo("block")


# --- Topology ids change after each operation (edit last, chips) ---


def test_edit_last_after_undo_and_redo_lands_on_the_same_face():
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    top = block_face(session.document.current, 0, 0, 1)
    selection = {"faces": [top]}
    send(session, "tool_commit", tool="push_pull", selection=selection, params={"distance": 3})
    assert volume(session.document.current.shape) == pytest.approx(40 * 30 * 23)
    # What the Edit last button does: undo, reselect the same ids, run the tool again with another value.
    send(session, "undo")
    assert block_face(session.document.current, 0, 0, 1) == top
    send(session, "tool_commit", tool="push_pull", selection=selection, params={"distance": 7})
    assert volume(session.document.current.shape) == pytest.approx(40 * 30 * 27)
    # Undo then redo returns to the redone model, and the same selection still addresses the top face.
    send(session, "undo")
    send(session, "redo")
    assert volume(session.document.current.shape) == pytest.approx(40 * 30 * 27)
    send(session, "undo")
    assert block_face(session.document.current, 0, 0, 1) == top
    assert volume(session.document.current.shape) == pytest.approx(40 * 30 * 20)


# --- Shell, draft and defeature on inputs the kernel cannot honor ---


def test_shell_thicker_than_the_wall_is_refused_and_a_fitting_one_is_valid(block):
    face = block_face(Topology(block), 1, 0, 0)
    with pytest.raises(OperationError, match="walls would not fit"):
        execute(block, "shell", faces=[face], thickness=14)
    ok = execute(block, "shell", faces=[face], thickness=2)
    assert BRepCheck_Analyzer(ok.shape).IsValid()
    assert volume(ok.shape) < volume(block) - 1000
    assert volume(block) == pytest.approx(24000)


def test_an_impossible_draft_is_refused_with_advice_and_leaves_the_model_alone(block):
    wall = block_face(Topology(block), 1, 0, 0)
    with pytest.raises(OperationError, match="try a smaller angle"):
        execute(block, "draft", faces=[wall], angle=89.9)
    with pytest.raises(OperationError, match="side wall"):
        execute(block, "draft", faces=[block_face(Topology(block), 0, 0, 1)], angle=3)
    ok = execute(block, "draft", faces=[wall], angle=3)
    assert BRepCheck_Analyzer(ok.shape).IsValid()
    assert volume(block) == pytest.approx(24000)


def test_defeaturing_an_outside_wall_says_nothing_changed(block):
    with pytest.raises(OperationError, match="nothing changed"):
        execute(block, "delete_face", faces=[block_face(Topology(block), 0, 0, 1)])


def test_a_failed_tool_through_the_session_leaves_history_untouched():
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    side = block_face(session.document.current, 1, 0, 0)
    for tool, params in (("shell", {"thickness": 20}), ("draft", {"angle": 89.9}), ("delete_face", {})):
        with pytest.raises(OperationError):
            session.handle({"type": "tool_commit", "tool": tool, "selection": {"faces": [side]}, "params": params})
        assert not session.document.can_undo
        assert volume(session.document.current.shape) == pytest.approx(24000)


# --- Fillet per edge: radii that clash at a shared vertex ---


def corner_edges(topology):
    """The three edges of the block that meet at one corner."""
    from OCP.TopAbs import TopAbs_VERTEX
    from OCP.TopExp import TopExp_Explorer

    vertex = next(i for i, _ in topology.vertices())
    found = []
    for i, e in topology.edges():
        ex = TopExp_Explorer(e, TopAbs_VERTEX)
        while ex.More():
            if topology.vertex_id(ex.Current()) == vertex:
                found.append(i)
                break
            ex.Next()
    assert len(found) == 3
    return found


def test_clashing_fillet_radii_at_a_shared_vertex_fail_cleanly(block):
    edges = corner_edges(Topology(block))
    fine = execute(block, "fillet_per_edge", edges=edges, preview=True, radii=[[4, 0]] * 3)
    assert BRepCheck_Analyzer(fine.shape).IsValid()
    assert volume(fine.shape) < 24000
    with pytest.raises(OperationError, match="Could not round these edges"):
        execute(block, "fillet_per_edge", edges=edges, preview=True, radii=[[25, 0]] * 3)
    assert volume(block) == pytest.approx(24000)


# --- Arrays: the 200 copy cap ---


@pytest.mark.parametrize("params", [{"count": 201, "rows": 1}, {"count": 15, "rows": 14}, {"count": 1, "rows": 1}])
def test_a_linear_array_outside_the_copy_limit_is_refused(block, params):
    with pytest.raises(OperationError, match="between 2 and 200"):
        execute(block, "linear_array", dx=50, dy2=40, **params)


def test_circular_and_path_arrays_refuse_counts_above_the_cap(block):
    with pytest.raises(OperationError, match="between 1 and 200"):
        execute(block, "circular_array", count=201)
    with pytest.raises(OperationError, match="between 2 and 200"):
        execute(block, "path_array", edges=[0], count=201)


# --- Patch fill followed by a fillet ---


def test_a_tangent_patch_fill_does_not_poison_a_later_fillet_in_the_same_process():
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Sewing

    box = Topology(load_demo("block"))
    top = block_face(box, 0, 0, 1)
    sewing = BRepBuilderAPI_Sewing(1e-6)
    for i, face in box.faces():
        if i != top:
            sewing.Add(face)
    sewing.Perform()
    open_body = Topology(sewing.SewedShape())
    free = [i for i, e in open_body.edges() if len(open_body.edge_faces(e)) == 1]
    patched = execute(open_body.shape, "patch_fill", edges=free, continuity=1)
    assert len(solids_of(patched.shape)) == 1
    assert volume(patched.shape) == pytest.approx(24000, rel=1e-3)
    # Fillets of the filled body and of a fresh block afterwards give valid, smaller solids.
    for shape in (patched.shape, load_demo("block")):
        topology = Topology(shape)
        edge = next(i for i, e in topology.edges() if len(topology.edge_faces(e)) == 2)
        rounded = execute(shape, "fillet_chamfer", edges=[edge], distance=2)
        assert BRepCheck_Analyzer(rounded.shape).IsValid()
        assert 23000 < volume(rounded.shape) < 24000
