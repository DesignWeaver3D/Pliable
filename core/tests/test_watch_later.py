"""Watch list corners: Cut and Refine on chosen bodies, picked-only projection, the sketch solver far-away guard, the Add slot depth grip, and the helical sweep limits."""

import pytest
from OCP.BRep import BRep_Builder
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakePolygon
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepPrimAPI import BRepPrimAPI_MakeCylinder
from OCP.Bnd import Bnd_Box
from OCP.TopoDS import TopoDS_Compound
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt

from pliable import sketch
from pliable.demos import load_demo
from pliable.ops import OperationError, solids_of
from pliable.server import RequestError, Session
from pliable.tools import Selection, get_tool
from pliable.topology import Topology
from test_sketch import sketch_of
from test_watch_modeling import block_face, send, volume


def two_bodies():
    """The 40 x 30 x 20 block (body 1, z -10..10) and a 10 cube (body 2, z 0..10); the plane z = 5 passes through both."""
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    send(session, "tool_commit", tool="add_box", selection={}, params={"width": 10, "depth": 10, "height": 10, "x": 100, "new_body": 1})
    return session


def body_volumes(session):
    return sorted(round(volume(s), 3) for s in solids_of(session.document.current.shape))


@pytest.mark.parametrize(
    "selection,expected",
    [
        ({"bodies": [1]}, [1000.0, 18000.0]),  # the plane crosses both, only the selected block is cut
        ({"bodies": [2]}, [500.0, 24000.0]),
        ({}, [500.0, 18000.0]),  # nothing selected: every body
    ],
)
def test_cut_with_plane_cuts_only_the_selected_bodies(selection, expected):
    session = two_bodies()
    send(session, "tool_commit", tool="cut_plane", selection=selection, params={"axis": 2, "position": 5, "remove_side": 1})
    assert body_volumes(session) == expected


def test_cut_with_plane_on_a_face_of_one_body_splits_only_that_body():
    session = two_bodies()
    cube_face = max(i for i, _ in session.document.current.faces())  # the cube was added last, so its faces have the highest ids
    header = send(session, "tool_commit", tool="cut_plane", selection={"faces": [cube_face]}, params={"axis": 2, "position": 5, "remove_side": 0})
    assert body_volumes(session) == [500.0, 500.0, 24000.0] and len(header["bodies"]) == 3


def test_refine_bodies_leaves_the_unchosen_body_untouched():
    session = two_bodies()
    before = list(solids_of(session.document.current.shape))
    send(session, "tool_commit", tool="unify", selection={"bodies": [1]}, params={})
    after = list(solids_of(session.document.current.shape))
    assert len(after) == 2 and after[1].IsSame(before[1])  # the unchosen cube is the very same shape
    assert body_volumes(session) == [1000.0, 24000.0]


def test_projection_takes_only_the_picked_items():
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    topology = session.document.current
    plane = sketch.STANDARD_PLANES["XY"]
    top = block_face(topology, 0, 0, 1)
    lines = lambda reply: [e for e in reply["entities"] if e["type"] == "line"]  # noqa: E731
    everything = session.handle({"type": "sketch_project", "plane": plane})
    face_only = session.handle({"type": "sketch_project", "plane": plane, "faces": [top]})
    one_edge = session.handle({"type": "sketch_project", "plane": plane, "edges": [0]})
    assert len(lines(face_only)) == 4 and len(lines(one_edge)) <= 1
    assert len(face_only["points"]) < len(everything["points"]) + 1 and len(lines(one_edge)) < len(lines(face_only))
    assert len(one_edge["points"]) <= 2
    with pytest.raises(RequestError, match="Unknown"):
        session.handle({"type": "sketch_project", "plane": plane, "faces": [999]})


def test_a_solved_point_beyond_the_guard_makes_the_solve_fail():
    def line_of_length(length):
        return sketch_of(
            [{"id": 1, "u": 0, "v": 0}, {"id": 2, "u": 1, "v": 0}],
            [{"id": 3, "type": "line", "a": 1, "b": 2}],
            [{"id": 4, "type": "fixed", "point": 1}, {"id": 5, "type": "distance", "points": [1, 2], "value": length}, {"id": 6, "type": "horizontal", "points": [1, 2]}],
        )

    assert sketch.solve(line_of_length(5e8))["status"] == "ok"
    far = sketch.solve(line_of_length(2e9))
    assert far["status"] == "failed" and far["points"] == []


def test_add_slot_depth_grip_starts_at_the_face_for_a_through_slot_and_hangs_below_for_a_depth():
    block = Topology(load_demo("block"))
    tool = get_tool("add_slot")
    selection = Selection(faces=[block_face(block, 0, 0, 1)])
    through = next(h for h in tool.handles(block, selection, tool.bind({})) if h.param == "depth")
    assert through.anchor[2] == pytest.approx(10.0) and through.min == 0.0  # on the top face (z = 10)
    deep = next(h for h in tool.handles(block, selection, tool.bind({"depth": 4})) if h.param == "depth")
    assert deep.anchor[2] == pytest.approx(6.0)


THREAD = [(9, 0, 0), (12, 0, 1), (12, 0, 2), (9, 0, 3)]
SWEEP = {"pitch": 5, "turns": 4, "hand": 0, "mode": 0, "axis": 2, "axis_edge": -1}


def helical_shape(profile_points):
    cylinder = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 10, 40).Shape()
    profile = BRepBuilderAPI_MakeFace(BRepBuilderAPI_MakePolygon(*[gp_Pnt(*p) for p in profile_points], True).Wire()).Face()
    shape = TopoDS_Compound()
    builder = BRep_Builder()
    builder.MakeCompound(shape)
    builder.Add(shape, cylinder)
    builder.Add(shape, profile)
    topology = Topology(shape)
    return topology, max(i for i, _ in topology.faces()), cylinder


def sweep(topology, face, **values):
    return get_tool("helical_sweep").run(topology, Selection(faces=[face], axes=[2]), {**SWEEP, **values}, False)


@pytest.mark.xfail(strict=True, reason="watch list: a profile that crosses the axis is not refused; Add returns the model unchanged (no volume added), Subtract says the coil does not meet the solid")
def test_a_helical_profile_that_crosses_the_axis_is_refused():
    crossing, face, _ = helical_shape([(-3, 0, 0), (5, 0, 0), (5, 0, 3), (-3, 0, 3)])
    with pytest.raises(OperationError):
        sweep(crossing, face)


def test_a_helical_profile_centred_on_the_axis_is_refused_and_a_normal_one_adds_a_thread():
    centred, face, _ = helical_shape([(-3, 0, 0), (3, 0, 0), (3, 0, 3), (-3, 0, 3)])
    with pytest.raises(OperationError, match="lies on the axis"):
        sweep(centred, face)
    fine, face, cylinder = helical_shape(THREAD)
    assert volume(sweep(fine, face).shape) > volume(cylinder) + 20


@pytest.mark.parametrize("turns", [16, 16.5])
@pytest.mark.parametrize("mode", [0, 1])
def test_a_coil_running_off_the_end_of_a_solid_gives_a_valid_solid(turns, mode):
    topology, face, cylinder = helical_shape(THREAD)  # 40 long; 16 turns of pitch 5 run 80 along the axis
    result = sweep(topology, face, turns=turns, mode=mode)
    assert BRepCheck_Analyzer(result.shape).IsValid()
    solids = solids_of(result.shape)
    assert len(solids) == 1
    box = Bnd_Box()
    BRepBndLib.Add_s(solids[0], box)
    if mode == 0:
        assert volume(result.shape) > volume(cylinder) + 100 and box.CornerMax().Z() > 41  # the thread sticks out past the end
    else:
        assert 0 < volume(result.shape) < volume(cylinder) - 100
