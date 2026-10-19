"""Manipulator handles: a tool declares one per parameter and the core sends them with the preview (docs/protocol.md)."""

import math

import pytest

from pliable.protocol import decode_binary
from pliable.server import Session
from pliable.tools import TOOLS, Accepts, Handle, Param, Tool


class _Stub(Tool):
    id = "stub_handles"
    label = "Stub"
    description = "A test tool with one slide handle on its length parameter."
    accepts = Accepts()
    starts_from = "tool"
    params = [Param("length", "length", 5), Param("flag", "number", 0)]

    def handles(self, topology, selection, values):
        return [
            Handle("length", "Length", (values["length"], 0, 0), (2, 0, 0), min=1),
            Handle("missing", "No such parameter", (0, 0, 0), (0, 0, 1)),
        ]

    def run(self, topology, selection, values, preview):
        from pliable.ops import OpResult

        return OpResult(topology.shape, [])


@pytest.fixture
def session(monkeypatch):
    monkeypatch.setitem(TOOLS, _Stub.id, _Stub())
    s = Session()
    s.handle({"type": "open_demo", "name": "block"})
    return s


def test_description_says_where_a_tool_starts_and_whether_it_has_handles(session):
    tools = {t["id"]: t for t in session.handle({"type": "list_tools"})["tools"]}
    assert tools["stub_handles"]["startsFrom"] == "tool" and tools["stub_handles"]["hasHandles"]
    assert tools["push_pull"]["startsFrom"] == "selection"
    assert tools["shell"]["hasHandles"] is False


def test_tool_handles_request_returns_normalised_handles_with_the_current_value(session):
    reply = session.handle({"type": "tool_handles", "tool": "stub_handles", "params": {"length": 7}})
    assert reply["startsFrom"] == "tool"
    (h,) = reply["handles"]  # the handle for an unknown parameter is dropped
    assert h["param"] == "length" and h["value"] == 7 and h["anchor"] == [7.0, 0.0, 0.0]
    assert h["direction"] == [1.0, 0.0, 0.0] and h["min"] == 1 and h["unit"] == "mm" and h["scale"] == 1.0


def test_defaults_fill_missing_values(session):
    (h,) = session.handle({"type": "tool_handles", "tool": "stub_handles"})["handles"]
    assert h["value"] == 5


def test_preview_reply_carries_handles_and_commit_does_not(session):
    header, _ = decode_binary(session.handle({"type": "tool_preview", "tool": "stub_handles", "params": {"length": 3}}))
    assert header["handles"][0]["value"] == 3
    header, _ = decode_binary(session.handle({"type": "tool_commit", "tool": "stub_handles", "params": {"length": 3}}))
    assert header["handles"] == []


def test_tools_without_handles_send_an_empty_list(session):
    reply = session.handle({"type": "tool_handles", "tool": "unify"})
    assert reply["handles"] == []




# ---- Primitive handles (box, cylinder, sphere, cone, torus) -------------------------------------------------------

from OCP.BRep import BRep_Builder  # noqa: E402
from OCP.Bnd import Bnd_Box  # noqa: E402
from OCP.TopoDS import TopoDS_Compound  # noqa: E402
from OCP.BRepBndLib import BRepBndLib  # noqa: E402

from pliable.tools import Selection  # noqa: E402
from pliable.topology import Topology  # noqa: E402

PRIMITIVES = {
    "add_box": {"width": 12, "depth": 8, "height": 6, "x": 3, "y": -2, "z": 1},
    "add_cylinder": {"diameter": 9, "height": 7, "x": 3, "y": -2, "z": 1},
    "add_sphere": {"diameter": 9, "x": 3, "y": -2, "z": 1},
    "add_cone": {"bottom_diameter": 10, "top_diameter": 4, "height": 7, "x": 3, "y": -2, "z": 1},
    "add_torus": {"major": 20, "minor": 5, "x": 3, "y": -2, "z": 1},
}


def _bounds(shape):
    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, box, False, False)
    return box.CornerMin().X(), box.CornerMin().Y(), box.CornerMin().Z(), box.CornerMax().X(), box.CornerMax().Y(), box.CornerMax().Z()


def _volume(shape):
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps

    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return props.Mass()


def _handles(tool_id, params):
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    return session.handle({"type": "tool_handles", "tool": tool_id, "params": params})["handles"]


@pytest.mark.parametrize("tool_id", PRIMITIVES)
def test_primitive_starts_from_the_tool_with_a_handle_per_geometry_parameter(tool_id):
    tool = TOOLS[tool_id]
    assert tool.starts_from == "tool"
    handles = _handles(tool_id, PRIMITIVES[tool_id])
    sized = {h["param"] for h in handles}
    assert sized == {p.name for p in tool.params if p.name != "new_body"}  # one handle per parameter, none for new_body


@pytest.mark.parametrize("tool_id", PRIMITIVES)
def test_handles_follow_their_parameter(tool_id):
    """Dragging a handle by t along its direction sets value + scale * t, and the handle then sits t further along."""
    params = PRIMITIVES[tool_id]
    for h in _handles(tool_id, params):
        t = 1.5
        new = max(h["value"] + h["scale"] * t, h["min"] if h["min"] is not None else -1e9)
        travel = (new - h["value"]) / h["scale"]
        linked = {link["param"]: link["value"] + link["scale"] * travel for link in h["links"]}  # a low face also moves the origin
        after = _handles(tool_id, {**params, **linked, h["param"]: new})
        moved = next(h2 for h2 in after if h2["param"] == h["param"] and h2["direction"] == h["direction"])
        for a, b, d in zip(h["anchor"], moved["anchor"], h["direction"]):
            assert b == pytest.approx(a + d * travel), (tool_id, h["param"])


@pytest.mark.parametrize("tool_id", PRIMITIVES)
def test_size_handles_sit_on_the_solid_and_resizing_moves_its_extent(tool_id):
    params = PRIMITIVES[tool_id]
    tool = TOOLS[tool_id]
    builder = BRep_Builder()
    compound = TopoDS_Compound()
    builder.MakeCompound(compound)
    empty = Topology(compound)

    def solid(values):
        shape = tool.execute(empty, Selection(), {**values, "new_body": 1}, preview=True).shape
        return _bounds(shape), _volume(shape)

    base, base_volume = solid(params)
    for h in _handles(tool_id, params):
        if h["param"] in ("x", "y", "z"):
            continue
        axis = max(range(3), key=lambda i: abs(h["direction"][i]))
        # The anchor lies on the solid's outer extent along its axis (the tip of the top diameter sits just outside).
        lo, hi = base[axis], base[axis + 3]
        assert lo - 1.0 <= h["anchor"][axis] <= hi + 1.0, (tool_id, h["param"])
        # Pulling the handle outward grows the solid along its axis (so its volume increases).
        grown, grown_volume = solid({**params, h["param"]: h["value"] + 2 * h["scale"]})
        assert grown_volume > base_volume * 1.001, (tool_id, h["param"])


# ---- Whole-body tools ---------------------------------------------------------------------------------------------


def _body_handles(tool_id, params):
    session = Session()
    session.handle({"type": "open_demo", "name": "bracket"})
    return {h["param"]: h for h in session.handle({"type": "tool_handles", "tool": tool_id, "params": params})["handles"]}


def test_move_body_has_a_handle_per_axis_that_follows_its_distance():
    before = _body_handles("move_body", {})
    assert set(before) == {"dx", "dy", "dz"}
    after = _body_handles("move_body", {"dx": 4, "dy": -3})
    assert after["dx"]["anchor"][0] == pytest.approx(before["dx"]["anchor"][0] + 4)
    assert after["dy"]["anchor"][1] == pytest.approx(before["dy"]["anchor"][1] - 3)
    assert after["dz"]["anchor"] == pytest.approx([before["dz"]["anchor"][0] + 4, before["dz"]["anchor"][1] - 3, before["dz"]["anchor"][2]])  # the arrows travel with the body
    assert before["dz"]["direction"] == [0.0, 0.0, 1.0] and before["dz"]["scale"] == 1.0


def test_rotate_body_handle_sits_on_a_ring_at_the_current_angle():
    for angle in (0, 35, -120):
        h = _body_handles("rotate_body", {"axis": 2, "angle": angle})["angle"]
        x, y, z = h["anchor"]
        assert z == 0 and math.degrees(math.atan2(y, x)) == pytest.approx(angle)
        # the tangent is square to the radius, and travel along it turns by scale degrees per unit
        assert h["direction"][0] * x + h["direction"][1] * y == pytest.approx(0, abs=1e-9)
        assert h["unit"] == "°" and h["scale"] == pytest.approx(math.degrees(1 / math.hypot(x, y)))
    about_x = _body_handles("rotate_body", {"axis": 0, "angle": 0})["angle"]
    assert about_x["anchor"][0] == 0 and about_x["direction"][0] == 0


def test_rotate_body_handle_needs_a_valid_axis():
    assert _body_handles("rotate_body", {"axis": 5}) == {}


def test_scale_body_handle_stays_on_the_line_through_the_corner_and_follows_the_factor():
    h1 = _body_handles("scale_body", {"factor": 1})["factor"]
    h2 = _body_handles("scale_body", {"factor": 2})["factor"]
    assert h2["anchor"] == pytest.approx([2 * c for c in h1["anchor"]])
    t = 7.0  # travel along the line changes the factor by scale * t and moves the anchor by t
    h3 = _body_handles("scale_body", {"factor": 1 + h1["scale"] * t})["factor"]
    assert h3["anchor"] == pytest.approx([a + d * t for a, d in zip(h1["anchor"], h1["direction"])])
    assert h1["min"] == 1e-3


def test_body_handles_respect_the_selected_solid():
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    whole = session.handle({"type": "tool_handles", "tool": "move_body", "params": {}})["handles"]
    one_face = session.handle({"type": "tool_handles", "tool": "move_body", "selection": {"faces": [0]}, "params": {}})["handles"]
    assert whole and one_face


# ---- Push/pull ----------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("demo", ["block", "bracket", "perforated_plate"])
def test_push_pull_handle_sits_on_every_flat_face_and_points_along_its_normal(demo):
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
    from OCP.BRepExtrema import BRepExtrema_DistShapeShape
    from OCP.gp import gp_Pnt

    from pliable.ops import planar_normal

    session = Session()
    session.handle({"type": "open_demo", "name": demo})
    topology = session.document.current
    checked = 0
    for face_id, face in topology.faces():
        normal = planar_normal(face)
        if normal is None:
            continue
        (h,) = session.handle({"type": "tool_handles", "tool": "push_pull", "selection": {"faces": [face_id]}, "params": {}})["handles"]
        assert h["direction"] == pytest.approx([normal.X(), normal.Y(), normal.Z()])
        vertex = BRepBuilderAPI_MakeVertex(gp_Pnt(*h["anchor"])).Vertex()
        assert BRepExtrema_DistShapeShape(face, vertex).Value() < 1e-6, (demo, face_id)
        checked += 1
    assert checked >= 6


def test_push_pull_handle_follows_the_distance_and_skips_hole_walls():
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    flat = {"faces": [next(i for i, f in session.document.current.faces() if __import__("pliable.ops", fromlist=["x"]).planar_normal(f) is not None)]}
    h0 = session.handle({"type": "tool_handles", "tool": "push_pull", "selection": flat, "params": {}})["handles"][0]
    h5 = session.handle({"type": "tool_handles", "tool": "push_pull", "selection": flat, "params": {"distance": 5}})["handles"][0]
    assert h5["anchor"] == pytest.approx([a + 5 * d for a, d in zip(h0["anchor"], h0["direction"])])
    assert h5["value"] == 5

    session.handle({"type": "open_demo", "name": "bracket"})
    wall = next(i for i, f in session.document.current.faces() if _is_whole_cylinder(f))
    assert session.handle({"type": "tool_handles", "tool": "push_pull", "selection": {"faces": [wall]}, "params": {}})["handles"] == []


def _is_whole_cylinder(face):
    from pliable.tools import _all_round_walls

    class _T:
        def face(self, i):
            return face

    return _all_round_walls(_T(), Selection(faces=[0]))


# ---- Fillet and chamfer ---------------------------------------------------------------------------------------------

from OCP.BRepClass3d import BRepClass3d_SolidClassifier  # noqa: E402
from OCP.TopAbs import TopAbs_OUT  # noqa: E402
from OCP.gp import gp_Pnt as _Pnt  # noqa: E402

from pliable.features import solids_of  # noqa: E402
from pliable.ops import edge_curve, edge_outward_normal  # noqa: E402


def _block():
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    return session, session.document.current


def _removed(shape, point) -> bool:
    """Whether a point is outside the solid (material was cut away there)."""
    solid = solids_of(shape)[0]
    return BRepClass3d_SolidClassifier(solid, _Pnt(*point), 1e-7).State() == TopAbs_OUT


def _fillet_edges(topology):
    """Straight 90-degree edges of the block, the ones the corner-depth test below applies to."""
    return [(i, e) for i, e in topology.edges() if len(topology.edge_faces(e)) == 2]


def test_fillet_chamfer_handle_sits_on_the_edge_bisector_and_follows_the_distance():
    session, topology = _block()
    edge_id, edge = _fillet_edges(topology)[0]
    sel = {"edges": [edge_id]}
    normal = edge_outward_normal(topology, edge)
    at, _, _ = edge_curve(edge)
    (h0,) = session.handle({"type": "tool_handles", "tool": "fillet_chamfer", "selection": sel, "params": {}})["handles"]
    assert h0["anchor"] == pytest.approx(list(at(0.5))) and h0["direction"] == pytest.approx(normal)
    (h3,) = session.handle({"type": "tool_handles", "tool": "fillet_chamfer", "selection": sel, "params": {"distance": 3}})["handles"]
    assert h3["anchor"] == pytest.approx([a + 3 * n for a, n in zip(at(0.5), normal)])
    (hn,) = session.handle({"type": "tool_handles", "tool": "fillet_chamfer", "selection": sel, "params": {"distance": -2}})["handles"]
    assert hn["anchor"] == pytest.approx([a - 2 * n for a, n in zip(at(0.5), normal)])


@pytest.mark.parametrize("reverse", [0, 1])
def test_variable_fillet_end_handles_mark_the_ends_that_really_get_those_radii(reverse):
    """With start 5 and end 1 the big radius is at the handle named Start: material near that end is cut away deeper."""
    session, topology = _block()
    tool = TOOLS["variable_fillet"]
    checked = 0
    for edge_id, edge in _fillet_edges(topology):
        sel = Selection(edges=[edge_id])
        params = {"start": 5.0, "end": 1.0, "reverse": reverse}
        handles = {h["param"]: h for h in tool.handle_list(topology, sel, params)}
        normal = edge_outward_normal(topology, edge)
        at, _, _ = edge_curve(edge)
        try:
            shape = tool.execute(topology, sel, params, preview=True).shape
        except Exception:
            continue
        # The handle's base point on the edge is where its anchor stands minus the radius along the bisector.
        def base(name):
            return [a - n * handles[name]["value"] for a, n in zip(handles[name]["anchor"], normal)]

        deep = lambda p: [x - n * 1.4 for x, n in zip(p, normal)]  # noqa: E731  (1.4 in from the corner: cut at radius 5, not at 1)
        big_end, small_end = base("start"), base("end")
        for point in (big_end, small_end):  # move off the vertex a little along the edge
            assert min(sum((a - b) ** 2 for a, b in zip(point, at(u))) for u in (0.0, 1.0)) < 1e-12
        mid = at(0.5)
        toward = lambda p: [m + (x - m) * 0.9 for m, x in zip(mid, p)]  # noqa: E731
        assert _removed(shape, deep(toward(big_end))), (edge_id, reverse)
        assert not _removed(shape, deep(toward(small_end))), (edge_id, reverse)
        checked += 1
    assert checked >= 4


def test_variable_fillet_offers_interim_and_swap_handles_only_where_they_make_sense():
    session, topology = _block()
    (edge_id, _), (other_id, _) = _fillet_edges(topology)[:2]
    one = {h["param"]: h for h in TOOLS["variable_fillet"].handle_list(topology, Selection(edges=[edge_id]), {})}
    assert set(one) == {"start", "end", "reverse", "middle", "middle_at"}
    assert one["reverse"]["toggle"] and not one["start"]["toggle"]
    assert one["middle_at"]["min"] == 0.02 and one["middle_at"]["max"] == 0.98 and one["middle_at"]["value"] == 0.5
    two = {h["param"] for h in TOOLS["variable_fillet"].handle_list(topology, Selection(edges=[edge_id, other_id]), {})}
    assert two == {"start", "end", "reverse"}  # an interim point works on one edge at a time


def test_variable_fillet_interim_handles_follow_their_values():
    session, topology = _block()
    edge_id, edge = _fillet_edges(topology)[0]
    tool, sel = TOOLS["variable_fillet"], Selection(edges=[edge_id])
    at, tangent, length = edge_curve(edge)
    normal = edge_outward_normal(topology, edge)
    a = {h["param"]: h for h in tool.handle_list(topology, sel, {"middle": 2, "middle_at": 0.5})}
    b = {h["param"]: h for h in tool.handle_list(topology, sel, {"middle": 4, "middle_at": 0.7})}
    assert b["middle"]["anchor"][0] != a["middle"]["anchor"][0] or b["middle"]["anchor"][1] != a["middle"]["anchor"][1] or b["middle"]["anchor"][2] != a["middle"]["anchor"][2]
    # the point-along-edge handle moves by scale^-1 per fraction along the edge's own direction
    moved = [y - x for x, y in zip(a["middle_at"]["anchor"], b["middle_at"]["anchor"])]
    assert moved == pytest.approx([d * 0.2 * length for d in tangent(0.5)], abs=1e-6)
    assert a["middle_at"]["scale"] == pytest.approx(1 / length)


def test_chamfer_two_distances_handles_mark_the_leg_on_each_side_and_follow_the_swap():
    session, topology = _block()
    tool = TOOLS["chamfer_two_distances"]
    checked = 0
    for edge_id, edge in _fillet_edges(topology):
        face_id, face = next(((i, f) for i, f in topology.faces() if any(f.IsSame(x) for x in topology.edge_faces(edge))), (None, None))
        sel = Selection(faces=[face_id], edges=[edge_id])
        got = {}
        for swap in (0, 1):
            params = {"first": 3.0, "second": 1.0, "swap": swap}
            handles = {h["param"]: h for h in tool.handle_list(topology, sel, params)}
            assert set(handles) == {"first", "second", "swap"} and handles["swap"]["toggle"]
            shape = tool.execute(topology, sel, params, preview=True).shape
            at, _, _ = edge_curve(edge)
            corner = at(0.5)
            first_dir = handles["first"]["direction"]
            # the "first" handle's leg really is the long one: a point 2 along it, just off the corner, is cut away only then
            probe = [c + d * 2.0 for c, d in zip(corner, first_dir)]
            other = [c + d * 0.05 for c, d in zip(probe, handles["second"]["direction"])]
            got[swap] = _removed(shape, other)
            assert handles["first"]["anchor"] == pytest.approx([c + d * 3.0 for c, d in zip(corner, first_dir)])
        assert got == {0: True, 1: True}, (edge_id, got)  # the first handle tracks the long leg on whichever side it lies
        a0 = {h["param"]: h for h in tool.handle_list(topology, sel, {"swap": 0})}
        a1 = {h["param"]: h for h in tool.handle_list(topology, sel, {"swap": 1})}
        assert a0["first"]["direction"] == pytest.approx(a1["second"]["direction"])
        assert a0["first"]["direction"] != pytest.approx(a1["first"]["direction"])
        checked += 1
    assert checked >= 4


def test_primitive_move_arrows_point_the_positive_way_and_resize_grips_are_marked(session):
    for tool in ("add_box", "add_cylinder", "add_sphere", "add_cone", "add_torus"):
        handles = session.handle({"type": "tool_handles", "tool": tool, "params": {"x": 5, "y": 6, "z": 7}})["handles"]
        moves = {h["param"]: h for h in handles if h["kind"] == "move"}
        assert set(moves) == {"x", "y", "z"}
        for param, i in (("x", 0), ("y", 1), ("z", 2)):
            h = moves[param]
            assert h["direction"][i] == 1.0 and h["scale"] == 1.0 and h["value"] == (5, 6, 7)[i]
        assert all(h["kind"] == "resize" for h in handles if h["kind"] != "move")


def test_primitives_offer_anchor_points_with_the_default_at_the_placement_point(session):
    for tool in ("add_box", "add_cylinder", "add_sphere", "add_cone", "add_torus"):
        anchors = session.handle({"type": "tool_handles", "tool": tool})["anchors"]
        assert anchors and anchors[0]["offset"] == [0.0, 0.0, 0.0]
        assert len({a["label"] for a in anchors}) == len(anchors)
    box = {a["label"]: a["offset"] for a in session.handle({"type": "tool_handles", "tool": "add_box", "params": {"width": 4, "depth": 6, "height": 8}})["anchors"]}
    assert box["Centre"] == [2.0, 3.0, 4.0] and box["Corner (high X, high Y, high Z)"] == [4.0, 6.0, 8.0]
    assert len(box) == 27
    assert box["Middle of Z edge (high X, low Y)"] == [4.0, 0.0, 4.0]
    assert box["Middle of X edge (low Y, high Z)"] == [2.0, 0.0, 8.0]


def test_vector_tools_declare_their_move_vector(session):
    tools = {t["id"]: t for t in session.handle({"type": "list_tools"})["tools"]}
    for name in ("move_body", "linear_array", "move_hole", "pattern_hole"):
        assert tools[name]["moveVector"] == ["dx", "dy", "dz"]
    assert tools["add_box"]["moveVector"] is None and tools["push_pull"]["moveVector"] is None


def _box_handles(session, **params):
    return session.handle({"type": "tool_handles", "tool": "add_box", "params": params})["handles"]


def test_box_has_a_resize_grip_on_each_of_its_six_faces(session):
    handles = [h for h in _box_handles(session, x=1, y=2, z=3, width=4, depth=6, height=8) if h["kind"] == "resize"]
    assert len(handles) == 6
    anchors = {tuple(h["anchor"]) for h in handles}
    assert anchors == {(5, 5, 7), (1, 5, 7), (3, 8, 7), (3, 2, 7), (3, 5, 11), (3, 5, 3)}


def test_a_low_face_handle_grows_the_size_and_moves_the_origin_so_the_far_face_stays(session):
    handles = _box_handles(session, x=1, y=2, z=3, width=4, depth=6, height=8)
    low_x = next(h for h in handles if h["param"] == "width" and h["direction"] == [-1.0, 0.0, 0.0])
    assert low_x["scale"] == 1.0 and low_x["links"] == [{"param": "x", "scale": -1.0, "value": 1.0}]
    t = 2.5  # dragging outward by t along its direction
    width, x = low_x["value"] + low_x["scale"] * t, 1 + (-1.0) * t
    assert x + width == 1 + 4  # the high X face did not move
    high_x = next(h for h in handles if h["param"] == "width" and h["direction"] == [1.0, 0.0, 0.0])
    assert high_x["links"] == []


def test_dragging_a_low_face_keeps_the_far_face_in_the_real_preview(session):
    """Apply the values a low-face handle drag produces and read the box's bounds back from the preview mesh."""
    handles = _box_handles(session, x=1, y=2, z=3, width=4, depth=6, height=8)
    low_x = next(h for h in handles if h["param"] == "width" and h["direction"] == [-1.0, 0.0, 0.0])
    t = 2.5
    params = {"x": 1 + low_x["links"][0]["scale"] * t, "y": 2, "z": 3, "width": low_x["value"] + low_x["scale"] * t, "depth": 6, "height": 8, "new_body": 1}
    header, _ = decode_binary(session.handle({"type": "tool_preview", "tool": "add_box", "params": params}))
    lo, hi = header["bounds"][:3], header["bounds"][3:]
    assert hi[0] >= 5 - 1e-6 and lo[0] <= -1.5 + 1e-6  # the model now reaches the new low face at x = -1.5 and still the high face at x = 5


def test_cylinder_cone_sphere_and_torus_resize_handles(session):
    def of(tool, **params):
        return [h for h in session.handle({"type": "tool_handles", "tool": tool, "params": params})["handles"] if h["kind"] == "resize"]

    def check_pair(handles, param):
        """One single-ended radius handle plus a double-ended diameter handle across it, all setting `param`."""
        mine = [h for h in handles if h["param"] == param]
        (radius,) = [h for h in mine if h["symbol"] == "R"]
        pair = [h for h in mine if h["symbol"] == "Ø"]
        assert len(mine) == 3 and len(pair) == 2
        assert radius["factor"] == 0.5 and all(h["factor"] == 1.0 and h["scale"] == 2.0 for h in pair) and radius["scale"] == 2.0
        dot = lambda a, b: sum(x * y for x, y in zip(a, b))
        assert dot(pair[0]["direction"], pair[1]["direction"]) == pytest.approx(-1)  # the two ends face opposite ways
        assert dot(pair[0]["direction"], radius["direction"]) == pytest.approx(0)  # across, perpendicular to the radius handle
        return radius, pair

    cyl = of("add_cylinder", x=0, y=0, z=0, diameter=10, height=20)
    radius, pair = check_pair(cyl, "diameter")
    assert radius["anchor"] == [5.0, 0.0, 10.0] and radius["value"] == 10
    bottom = next(h for h in cyl if h["param"] == "height" and h["direction"] == [0.0, 0.0, -1.0])
    assert bottom["anchor"] == [0.0, 0.0, 0.0] and bottom["links"][0]["param"] == "z" and bottom["links"][0]["scale"] == -1.0
    assert next(h for h in cyl if h["param"] == "height" and h["direction"] == [0.0, 0.0, 1.0])["anchor"] == [0.0, 0.0, 20.0]
    sphere = of("add_sphere", x=0, y=0, z=0, diameter=10)
    check_pair(sphere, "diameter")
    assert len(sphere) == 3  # one parameter: one radius handle and the double-ended diameter handle, nothing else
    cone = of("add_cone", x=0, y=0, z=0, bottom_diameter=10, top_diameter=4, height=8)
    assert {h["param"] for h in cone} == {"bottom_diameter", "top_diameter", "height"} and len(cone) == 8
    (_, bottom_pair), (_, top_pair) = check_pair(cone, "bottom_diameter"), check_pair(cone, "top_diameter")
    assert abs(sum(a * b for a, b in zip(bottom_pair[0]["direction"], top_pair[0]["direction"]))) < 1e-9  # the top set is turned a quarter turn
    torus = of("add_torus", x=0, y=0, z=0, major=20, minor=6)
    assert {h["param"] for h in torus} == {"major", "minor"} and len(torus) == 6
    check_pair(torus, "major")
    check_pair(torus, "minor")


@pytest.mark.parametrize("tool_id", PRIMITIVES)
def test_a_picked_base_point_goes_to_the_destination_even_off_the_shape(tool_id):
    """The view's rule: placement = destination - (base - placement). The new shape moves by destination minus base."""
    params = PRIMITIVES[tool_id]
    tool = TOOLS[tool_id]
    builder = BRep_Builder()
    compound = TopoDS_Compound()
    builder.MakeCompound(compound)
    empty = Topology(compound)

    def bounds(values):
        return _bounds(tool.execute(empty, Selection(), {**values, "new_body": 1}, preview=True).shape)

    origin = (params["x"], params["y"], params["z"])
    base = (40.0, -7.0, 25.0)  # nowhere near the shape
    destination = (1.0, 2.0, 3.0)
    placed = tuple(o + d - b for o, d, b in zip(origin, destination, base))
    before, after = bounds(params), bounds({**params, "x": placed[0], "y": placed[1], "z": placed[2]})
    for i in range(6):
        assert after[i] - before[i] == pytest.approx(destination[i % 3] - base[i % 3], abs=1e-3)


def test_preview_mesh_skips_edge_drag_directions():
    session = Session(None)
    session.handle({"type": "open_demo", "name": "bracket"})
    params = {"width": 5, "depth": 5, "height": 5, "x": 0, "y": 0, "z": 0, "new_body": 1}
    preview, _ = decode_binary(session.handle({"type": "tool_preview", "tool": "add_box", "selection": {}, "params": params}))
    commit, _ = decode_binary(session.handle({"type": "tool_commit", "tool": "add_box", "selection": {}, "params": params}))
    assert all(e["normal"] is None for e in preview["edges"])
    assert any(e["normal"] is not None for e in commit["edges"])
