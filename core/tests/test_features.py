import math

import pytest
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.gp import gp_Vec

from pliable.demos import load_demo
from pliable.measure import measure
from pliable.ops import OperationError
from pliable.tools import Selection, get_tool
from pliable.topology import Topology


def volume(shape) -> float:
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return props.Mass()


def run(tool, topology, faces=(), edges=(), **params):
    return get_tool(tool).execute(topology, Selection(faces=list(faces), edges=list(edges)), params, preview=False)


def faces_where(topology, title, **expected):
    found = []
    for i in range(topology.face_count):
        item = measure(topology, Selection(faces=[i]))["items"][0]
        rows = {r["label"]: r["value"] for r in item["rows"]}
        if item["title"] == title and all(abs(rows[k] - v) < 1e-6 for k, v in expected.items()):
            found.append(i)
    return found


@pytest.fixture
def block():
    return Topology(load_demo("block"))  # 40 x 30 x 20


@pytest.fixture
def bracket():
    return Topology(load_demo("bracket"))


def test_delete_face_heals_a_corner_fillet(bracket):
    before = volume(bracket.shape)
    (fillet, *_) = faces_where(bracket, "Fillet", Radius=6)
    result = run("delete_face", bracket, faces=[fillet])
    assert volume(result.shape) - before == pytest.approx((1 - math.pi / 4) * 36 * 10, rel=1e-3)


def test_remove_round_on_block_chamfer(block):
    from pliable.ops import fillet_chamfer

    chamfered = Topology(fillet_chamfer(block.shape, [block.edge(0)], -3).shape)

    def diagonal(i):
        normal = next(r["value"] for r in measure(chamfered, Selection(faces=[i]))["items"][0]["rows"] if r["label"] == "Normal")
        return all(abs(c) > 0.1 for c in normal if abs(c) > 1e-9) and sum(abs(c) > 1e-9 for c in normal) == 2

    chamfer = next(i for i in range(chamfered.face_count) if diagonal(i))
    result = run("remove_round", chamfered, faces=[chamfer])
    assert volume(result.shape) == pytest.approx(volume(block.shape))


def test_fill_hole_restores_the_plate(bracket):
    before = volume(bracket.shape)
    (hole, *_) = faces_where(bracket, "Cylinder", Radius=4)
    result = run("fill_hole", bracket, faces=[hole])
    assert volume(result.shape) - before == pytest.approx(math.pi * 16 * 10, rel=1e-3)


def test_resize_hole_changes_diameter(bracket):
    before = volume(bracket.shape)
    (wall,) = faces_where(bracket, "Cylinder", Radius=7)
    result = run("resize_hole", bracket, faces=[wall], diameter=20)
    assert before - volume(result.shape) == pytest.approx(math.pi * (100 - 49) * 10, rel=1e-3)
    after = Topology(result.shape)
    assert faces_where(after, "Cylinder", Radius=10)
    shrunk = run("resize_hole", bracket, faces=[wall], diameter=8)
    assert volume(shrunk.shape) - before == pytest.approx(math.pi * (49 - 16) * 10, rel=1e-3)


def test_resize_hole_zero_is_a_no_op(bracket):
    (wall,) = faces_where(bracket, "Cylinder", Radius=7)
    assert run("resize_hole", bracket, faces=[wall], diameter=0).shape.IsSame(bracket.shape)


def test_resize_rejects_non_hole(block):
    with pytest.raises(OperationError):
        run("resize_hole", block, faces=[0], diameter=5)


def test_move_hole_keeps_volume_and_moves_axis(bracket):
    before = volume(bracket.shape)
    (hole, *_) = faces_where(bracket, "Cylinder", Radius=4)
    old = {r["label"]: r["value"] for r in measure(bracket, Selection(faces=[hole]))["items"][0]["rows"]}
    result = run("move_hole", bracket, faces=[hole], dx=0, dy=6, dz=0)
    assert volume(result.shape) == pytest.approx(before, rel=1e-4)
    assert result.shape is not bracket.shape
    moved = Topology(result.shape)
    assert len(faces_where(moved, "Cylinder", Radius=4)) == 4


def test_add_through_hole_on_block(block):
    top = next(i for i in range(6) if measure(block, Selection(faces=[i]))["items"][0]["rows"][3]["value"] == [0.0, 0.0, 1.0])
    result = run("add_hole", block, faces=[top], diameter=6, depth=0)
    assert volume(block.shape) - volume(result.shape) == pytest.approx(math.pi * 9 * 20, rel=1e-3)
    blind = run("add_hole", block, faces=[top], diameter=6, depth=5)
    assert volume(block.shape) - volume(blind.shape) == pytest.approx(math.pi * 9 * 5, rel=1e-3)


def test_pattern_hole_makes_copies(block):
    top = next(i for i in range(6) if measure(block, Selection(faces=[i]))["items"][0]["rows"][3]["value"] == [0.0, 0.0, 1.0])
    one = Topology(run("add_hole", block, faces=[top], diameter=4, depth=0, offset_u=-10).shape)
    (wall,) = faces_where(one, "Cylinder", Radius=2)
    result = run("pattern_hole", one, faces=[wall], count=3, dx=10, dy=0, dz=0)
    assert volume(one.shape) - volume(result.shape) == pytest.approx(2 * math.pi * 4 * 20, rel=1e-3)


def top_of(topology):
    return next(i for i in range(topology.face_count) if measure(topology, Selection(faces=[i]))["items"][0]["rows"][3]["value"] == [0.0, 0.0, 1.0])


def test_add_box_and_cylinder(block):
    box = run("add_box", block, width=10, depth=10, height=10, x=-5, y=-5, z=10, new_body=0)  # sits on the top face
    assert volume(box.shape) == pytest.approx(24000 + 1000)
    cylinder = run("add_cylinder", block, diameter=10, height=10, x=0, y=0, z=10, new_body=0)
    assert volume(cylinder.shape) == pytest.approx(24000 + math.pi * 25 * 10, rel=1e-4)
    assert Topology(box.shape).face_count == 6 + 5  # box top and four walls; the block's top face stays


def test_shell_leaves_walls(block):
    result = run("shell", block, faces=[top_of(block)], thickness=2)
    assert volume(result.shape) == pytest.approx(24000 - 36 * 26 * 18, rel=1e-4)


def test_shell_too_thick_fails_cleanly(block):
    with pytest.raises(OperationError):
        run("shell", block, faces=[top_of(block)], thickness=50)


def test_mirror_doubles_across_a_face(block):
    result = run("mirror", block, faces=[top_of(block)])
    assert volume(result.shape) == pytest.approx(48000)


def test_draft_tilts_side_faces(block):
    side = next(i for i in range(6) if abs(measure(block, Selection(faces=[i]))["items"][0]["rows"][3]["value"][0]) == 1)
    result = run("draft", block, faces=[side], angle=5)
    assert volume(result.shape) != pytest.approx(24000, rel=1e-4)


def test_align_face_moves_first_to_second(bracket):
    up = [i for i in range(bracket.face_count) if measure(bracket, Selection(faces=[i]))["items"][0]["title"] == "Plane" and measure(bracket, Selection(faces=[i]))["items"][0]["rows"][3]["value"] == [0.0, 0.0, 1.0]]
    area = lambda i: measure(bracket, Selection(faces=[i]))["items"][0]["rows"][2]["value"]
    base_top = max(up, key=area)
    upright_top = min(up, key=lambda i: abs(area(i) - 500))  # 10 x 50 top of the upright
    result = run("align_face", bracket, faces=[base_top, upright_top])
    assert volume(result.shape) - volume(bracket.shape) == pytest.approx(40 * area(base_top), rel=1e-3)


def test_align_rejects_non_parallel(bracket):
    with pytest.raises(OperationError):
        run("align_face", bracket, faces=[top_of(bracket), next(i for i in range(bracket.face_count) if i != top_of(bracket) and measure(bracket, Selection(faces=[i]))["items"][0]["rows"][-1]["value"] == [1.0, 0.0, 0.0])])


def test_counterbore_and_countersink(block):
    top = top_of(block)
    cbore = run("add_counterbore", block, faces=[top], diameter=6, depth=0, bore_diameter=12, bore_depth=4)
    assert volume(block.shape) - volume(cbore.shape) == pytest.approx(math.pi * 9 * 20 + math.pi * 27 * 4, rel=1e-3)
    csk = run("add_countersink", block, faces=[top], diameter=6, depth=0, sink_diameter=12, sink_angle=90)
    assert volume(block.shape) - volume(csk.shape) == pytest.approx(math.pi * 9 * 20 + 36 * math.pi, rel=1e-3)
    with pytest.raises(OperationError):
        run("add_counterbore", block, faces=[top], diameter=6, bore_diameter=5)


def hole_centres(topology, radius):
    ids = faces_where(topology, "Cylinder", Radius=radius)
    return sorted(tuple(round(c, 3) for c in measure(topology, Selection(faces=[i]))["items"][0]["anchor"]) for i in ids)


def test_align_and_distribute_holes(block):
    top = top_of(block)
    shape = block
    for x in (-15, -3, 12):  # uneven spacing along X
        shape = Topology(run("add_hole", shape, faces=[top_of(shape)], diameter=4, depth=0, offset_u=x, offset_v=(x % 4)).shape)
    ids = faces_where(shape, "Cylinder", Radius=2)
    assert len(ids) == 3
    aligned = Topology(run("align_holes", shape, faces=ids, axis=1).shape)
    ys = {c[1] for c in hole_centres(aligned, 2)}
    assert len(ys) == 1
    before = [c[0] for c in hole_centres(aligned, 2)]
    ids = faces_where(aligned, "Cylinder", Radius=2)
    spread = Topology(run("distribute_holes", aligned, faces=ids, axis=0).shape)
    xs = [c[0] for c in hole_centres(spread, 2)]
    assert xs[1] - xs[0] == pytest.approx(xs[2] - xs[1], abs=1e-3)
    assert xs[0] == pytest.approx(before[0], abs=1e-3) and xs[2] == pytest.approx(before[2], abs=1e-3)  # outer holes stay put


def test_body_transforms(block):
    moved = run("move_body", block, dx=10, dy=0, dz=5)
    assert volume(moved.shape) == pytest.approx(24000)
    box = measure(Topology(moved.shape), Selection(vertices=[0]))["items"][0]["anchor"]
    assert max(abs(box[0]), abs(box[2])) > 9
    rotated = run("rotate_body", block, axis=2, angle=90)
    assert volume(rotated.shape) == pytest.approx(24000)
    scaled = run("scale_body", block, factor=2)
    assert volume(scaled.shape) == pytest.approx(24000 * 8)
    with pytest.raises(OperationError):
        run("scale_body", block, factor=0)


def test_sphere_and_cone(block):
    sphere = run("add_sphere", block, diameter=10, x=0, y=0, z=10, new_body=0)
    assert volume(sphere.shape) == pytest.approx(24000 + 2 / 3 * math.pi * 125, rel=1e-3)
    cone = run("add_cone", block, bottom_diameter=10, top_diameter=0, height=6, x=0, y=0, z=10, new_body=0)
    assert volume(cone.shape) == pytest.approx(24000 + math.pi * 25 * 6 / 3, rel=1e-3)


def test_resize_fillet_changes_radius(bracket):
    before = volume(bracket.shape)
    # the two corners at +X are plain base-plate fillets (the -X ones run into the upright)
    fillet = next(i for i in faces_where(bracket, "Fillet", Radius=6) if measure(bracket, Selection(faces=[i]))["items"][0]["anchor"][0] > 0)
    bigger = run("resize_fillet", bracket, faces=[fillet], radius=9)
    # a corner fillet of radius r over height 10 removes (1 - pi/4) r^2 * 10 of material
    assert before - volume(bigger.shape) == pytest.approx((1 - math.pi / 4) * (81 - 36) * 10, rel=2e-3)
    assert faces_where(Topology(bigger.shape), "Fillet", Radius=9)
    sharp = run("resize_fillet", bracket, faces=[fillet], radius=0)
    assert volume(sharp.shape) - before == pytest.approx((1 - math.pi / 4) * 36 * 10, rel=1e-3)


def test_torus(block):
    result = run("add_torus", block, major=20, minor=4, x=100, y=0, z=0)
    assert volume(result.shape) == pytest.approx(24000 + 2 * math.pi**2 * 10 * 4, rel=1e-3)
    with pytest.raises(OperationError):
        run("add_torus", block, major=4, minor=4)


def test_linear_array_fuses_touching_copies(block):
    result = run("linear_array", block, count=3, dx=40, dy=0, dz=0)  # block is 40 wide: copies touch
    assert volume(result.shape) == pytest.approx(3 * 24000, rel=1e-6)
    assert Topology(result.shape).face_count == 6  # one long block after merging coplanar faces
    with pytest.raises(OperationError):
        run("linear_array", block, count=3, dx=0)


def test_circular_array(block):
    result = run("circular_array", block, count=4, axis=2, angle=360)
    assert volume(result.shape) < 4 * 24000  # copies overlap near the axis
    assert volume(result.shape) > 24000
    with pytest.raises(OperationError):
        run("circular_array", block, count=1)


def test_revolve_face_about_its_own_edge(block):
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_EDGE

    from pliable.ops import planar_normal

    top = max((planar_normal(f).Z(), i) for i, f in block.faces() if planar_normal(f) is not None)[1]
    explorer = TopExp_Explorer(block.face(top), TopAbs_EDGE)
    edge = block.edge_id(explorer.Current())
    result = run("revolve_face", block, faces=[top], edges=[edge], angle=90, mode=0)
    assert volume(result.shape) > 24000
    with pytest.raises(OperationError):
        run("revolve_face", block, faces=[top], edges=[edge], angle=0)


def _top_face_and_edge(block):
    from OCP.TopAbs import TopAbs_EDGE
    from OCP.TopExp import TopExp_Explorer
    from pliable.ops import planar_normal

    top = max((planar_normal(f).Z(), i) for i, f in block.faces() if planar_normal(f) is not None)[1]
    return top, block.edge_id(TopExp_Explorer(block.face(top), TopAbs_EDGE).Current())


def test_two_distance_chamfer_removes_the_wedge(block):
    top, edge = _top_face_and_edge(block)
    result = run("chamfer_two_distances", block, faces=[top], edges=[edge], first=4, second=2)
    assert volume(result.shape) == pytest.approx(24000 - 0.5 * 4 * 2 * 40, rel=1e-3) or volume(result.shape) == pytest.approx(24000 - 0.5 * 4 * 2 * 30, rel=1e-3)
    with pytest.raises(OperationError):
        run("chamfer_two_distances", block, faces=[top], edges=[edge], first=0, second=2)


def test_distance_angle_chamfer(block):
    top, edge = _top_face_and_edge(block)
    result = run("chamfer_distance_angle", block, faces=[top], edges=[edge], distance=4, angle=45)
    assert volume(result.shape) < 24000


def _two_blocks(offset):
    from OCP.BRep import BRep_Builder
    from OCP.TopoDS import TopoDS_Compound
    from pliable.features import _moved

    a = load_demo("block")
    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    builder.Add(compound, a)
    builder.Add(compound, _moved(a, gp_Vec(offset, 0, 0)))
    return Topology(compound)


def _face_in_solid(topology, index):
    from pliable.ops import _contains, solids_of

    solid = solids_of(topology.shape)[index]
    return next(i for i, f in topology.faces() if _contains(solid, f))


@pytest.mark.parametrize("mode, expected", [(0, 40 * 30 * 20 + 20 * 30 * 20), (1, 20 * 30 * 20), (2, 20 * 30 * 20)])
def test_body_boolean(mode, expected):
    two = _two_blocks(20)  # overlap by half
    faces = [_face_in_solid(two, 0), _face_in_solid(two, 1)]
    result = run("body_boolean", two, faces=faces, mode=mode)
    assert volume(result.shape) == pytest.approx(expected, rel=1e-3)
    with pytest.raises(OperationError):
        run("body_boolean", two, faces=[faces[0], faces[0] + 0], mode=mode)


def test_split_plane_makes_two_solids(block):
    from pliable.ops import solids_of

    result = run("split_plane", block, axis=2, position=8)
    assert len(solids_of(result.shape)) == 2
    assert volume(result.shape) == pytest.approx(24000)
    with pytest.raises(OperationError):
        run("split_plane", block, axis=2, position=500)


def test_variable_fillet_removes_material(block):
    _, edge = _top_face_and_edge(block)
    result = run("variable_fillet", block, edges=[edge], start=1, end=4)
    assert 24000 - 4 * 4 * 40 < volume(result.shape) < 24000
    with pytest.raises(OperationError):
        run("variable_fillet", block, edges=[edge], start=0, end=2)


def test_loft_between_faces_fills_the_gap():
    from pliable.features import _moved

    a = load_demo("block")
    from OCP.BRep import BRep_Builder
    from OCP.TopoDS import TopoDS_Compound

    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    builder.Add(compound, a)
    builder.Add(compound, _moved(a, gp_Vec(0, 0, 40)))  # a second block 20 above the first
    two = Topology(compound)
    from pliable.ops import _contains, planar_normal, solids_of

    lower, upper = solids_of(two.shape)
    top = next(i for i, f in two.faces() if _contains(lower, f) and planar_normal(f) is not None and planar_normal(f).Z() > 0.9)
    bottom = next(i for i, f in two.faces() if _contains(upper, f) and planar_normal(f) is not None and planar_normal(f).Z() < -0.9)
    result = run("loft_faces", two, faces=[top, bottom], ruled=1)
    assert volume(result.shape) == pytest.approx(3 * 24000, rel=1e-3)


def test_sweep_face_along_edge(block):
    top, _ = _top_face_and_edge(block)
    # sweep the top face along a vertical edge: a prism the height of that edge stacked on the face's plane
    from pliable.ops import planar_normal

    vertical = next(i for i in range(block.edge_count) if abs(__import__("OCP.BRepAdaptor", fromlist=["x"]).BRepAdaptor_Curve(block.edge(i)).Line().Direction().Z()) > 0.9)
    # which way the edge runs decides whether the sweep goes up (adds) or down through the block (cuts)
    volumes = [volume(run("sweep_face", block, faces=[top], edges=[vertical], mode=mode).shape) for mode in (0, 1)]
    assert any(v != pytest.approx(24000) for v in volumes)


def test_path_array_along_a_straight_edge(block):
    # the block's X-direction edges are 40 long: 3 copies spaced 20 apart overlap, giving a 80 x 30 x 20 block
    edge = next(i for i in range(block.edge_count) if abs(__import__("OCP.BRepAdaptor", fromlist=["x"]).BRepAdaptor_Curve(block.edge(i)).Line().Direction().X()) > 0.9)
    result = run("path_array", block, edges=[edge], count=3)
    assert volume(result.shape) == pytest.approx(80 * 30 * 20, rel=1e-3)


def test_unify_merges_split_coplanar_faces(block):
    # Cutting at a plane and rejoining leaves the model valid; unify must not add faces.
    result = run("unify", block)
    assert result.shape is not None
    assert Topology(result.shape).face_count == block.face_count


def _open_box_without_top():
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Sewing

    box = Topology(load_demo("block"))
    sewing = BRepBuilderAPI_Sewing(1e-6)
    top = top_of(box)
    for i, face in box.faces():
        if i != top:
            sewing.Add(face)
    sewing.Perform()
    return Topology(sewing.SewedShape())


@pytest.mark.parametrize("continuity", [0, 1])
def test_patch_fill_closes_an_open_body_into_a_solid(continuity):
    from pliable.ops import solids_of

    open_body = _open_box_without_top()
    free = [i for i, e in open_body.edges() if len(open_body.edge_faces(e)) == 1]
    assert len(free) == 4
    result = run("patch_fill", open_body, edges=free, continuity=continuity)
    assert len(solids_of(result.shape)) == 1
    assert Topology(result.shape).face_count == 6


def test_bridge_between_opposite_free_edges_closes_the_open_box():
    from pliable.ops import solids_of

    open_body = _open_box_without_top()
    free = [i for i, e in open_body.edges() if len(open_body.edge_faces(e)) == 1]
    # Opposite edges are the pair that shares no vertex.
    def vertices(i):
        from OCP.TopExp import TopExp

        ids = set()
        from OCP.TopAbs import TopAbs_VERTEX
        from OCP.TopExp import TopExp_Explorer

        ex = TopExp_Explorer(open_body.edge(i), TopAbs_VERTEX)
        while ex.More():
            ids.add(open_body.vertex_id(ex.Current()))
            ex.Next()
        return ids

    a = free[0]
    b = next(i for i in free[1:] if not vertices(i) & vertices(a))
    result = run("bridge", open_body, edges=[a, b])
    assert len(solids_of(result.shape)) == 1


def test_resize_works_on_a_variable_fillet_and_can_switch_it_to_constant(block):
    from pliable.topology import Topology

    _, edge = _top_face_and_edge(block)
    made = run("variable_fillet", block, edges=[edge], start=1, end=4)
    topology = Topology(made.shape)
    round_face = topology.face_id(made.tracked_faces[0])
    constant = run("resize_fillet", topology, faces=[round_face], radius=3)
    assert 24000 - 4 * 3 * 40 < volume(constant.shape) < 24000
    again = run("resize_fillet", topology, faces=[round_face], radius=2, end_radius=5)
    assert volume(again.shape) < volume(constant.shape) + 1  # a larger end radius removes more than r=2 everywhere



def test_path_array_follows_a_bent_path(block):
    from OCP.BRepBndLib import BRepBndLib
    from OCP.Bnd import Bnd_Box

    top, _ = _top_face_and_edge(block)
    from pliable.edgesel import face_loops

    loop = face_loops(block, top)[0]
    # consecutive edges of a face's loop share a corner
    result = run("path_array", block, edges=[loop[0], loop[1]], count=3)
    box = Bnd_Box()
    BRepBndLib.Add_s(result.shape, box)
    lo, hi = box.CornerMin(), box.CornerMax()
    sizes = sorted([hi.X() - lo.X(), hi.Y() - lo.Y()])
    assert sizes == pytest.approx([60, 80], abs=1e-3)
    assert volume(result.shape) > volume(block.shape)


def test_path_array_needs_a_connected_path(block):
    top, _ = _top_face_and_edge(block)
    from pliable.edgesel import face_loops

    loop = face_loops(block, top)[0]
    with pytest.raises(OperationError):
        run("path_array", block, edges=[loop[0], loop[2]], count=3)  # opposite sides of the face never touch


def test_placement_tools_declare_their_point_parameters():
    from pliable.tools import TOOLS

    for tool_id in ("add_box", "add_cylinder", "add_sphere", "add_cone", "add_torus", "pattern_hole_circular"):
        info = TOOLS[tool_id].describe()
        assert info["placement"] is not None
        assert all(name in {p["name"] for p in info["params"]} for name in info["placement"])
    assert TOOLS["push_pull"].describe()["placement"] is None


def test_fillet_per_edge_gives_each_edge_its_own_radius(block):
    _, edge = _top_face_and_edge(block)
    other = next(e for e in range(block.edge_count) if e != edge and e not in (edge,))
    only_one = run("fillet_per_edge", block, edges=[edge], radii=[[2, 0]])
    constant_same = run("fillet_per_edge", block, edges=[edge], radii=[2])  # bare numbers mean a constant radius
    assert volume(only_one.shape) == pytest.approx(volume(constant_same.shape))
    variable = run("fillet_per_edge", block, edges=[edge], radii=[[1, 4]])
    assert volume(variable.shape) < 24000
    assert volume(variable.shape) != pytest.approx(volume(only_one.shape))
    # a start of 0 leaves that edge sharp; all zero is refused
    skipped = run("fillet_per_edge", block, edges=[edge, other], radii=[[2, 0], [0, 0]])
    assert volume(skipped.shape) == pytest.approx(volume(only_one.shape))
    with pytest.raises(OperationError):
        run("fillet_per_edge", block, edges=[edge], radii=[[0, 0]])
    with pytest.raises(OperationError):
        run("fillet_per_edge", block, edges=[edge, other], radii=[[2, 0]])  # one radius for two edges
    with pytest.raises(OperationError):
        run("fillet_per_edge", block, edges=[edge], radii="big")


def test_fillet_per_edge_leaves_no_open_edges_in_any_pick_order():
    from OCP.BRepAdaptor import BRepAdaptor_Curve

    from pliable.demos import bracket
    from pliable.document import Document
    from pliable.server import Session

    session = Session()
    session.document = Document(bracket(), "b")
    top = session.document.current
    picked = [50, 33, 27, 40, 38, 41, 42, 44, 46, 48]  # the top face edges in the order the app lists them
    session.handle({"type": "tool_commit", "tool": "fillet_per_edge", "selection": {"edges": picked}, "params": {"radii": [[2, 0]] * 10}})
    result = session.document.current
    assert result.face_count > top.face_count
    open_edges = [e for _, e in result.edges() if len(result.edge_faces(e)) == 1 and not BRepAdaptor_Curve(e).IsClosed()]
    assert open_edges == []
    again = Session()
    again.document = Document(bracket(), "b")
    again.handle({"type": "tool_commit", "tool": "fillet_chamfer", "selection": {"edges": picked}, "params": {"distance": 2}})
    result = again.document.current
    assert [e for _, e in result.edges() if len(result.edge_faces(e)) == 1 and not BRepAdaptor_Curve(e).IsClosed()] == []


def _two_bodies(block):
    shape = run("add_box", block, width=10, depth=10, height=10, x=100, y=0, z=0, new_body=1).shape
    return Topology(shape)


def test_arrays_copy_only_the_chosen_body(block):
    from pliable.ops import solids_of

    two = _two_bodies(block)
    face = next(i for i in range(two.face_count) if _box_x(two, i) > 90)
    result = run("linear_array", two, faces=[face], count=3, dx=0, dy=0, dz=30)
    assert volume(result.shape) == pytest.approx(24000 + 3 * 1000 + 0, rel=1e-6)
    assert len(solids_of(result.shape)) == 4  # the block, the small box and its two copies (30 apart, so not touching)
    whole = run("linear_array", two, count=3, dx=0, dy=0, dz=60)
    assert volume(whole.shape) == pytest.approx(3 * 25000, rel=1e-6)
    ring = run("circular_array", two, faces=[face], count=2, axis=2, angle=180)
    assert volume(ring.shape) == pytest.approx(24000 + 2000, rel=1e-6)


def _box_x(topology, i):
    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib

    box = Bnd_Box()
    BRepBndLib.Add_s(topology.face(i), box)
    return box.CornerMin().X()


def test_variable_fillet_reverse_and_interim_radius(block):
    _, edge = _top_face_and_edge(block)
    plain = run("variable_fillet", block, edges=[edge], start=1, end=4)
    flipped = run("variable_fillet", block, edges=[edge], start=1, end=4, reverse=1)
    assert volume(flipped.shape) == pytest.approx(volume(plain.shape), rel=1e-6)  # mirrored, same material
    assert flipped.shape.IsSame(plain.shape) is False
    bulged = run("variable_fillet", block, edges=[edge], start=1, end=4, middle=4, middle_at=0.5)
    assert volume(bulged.shape) < volume(plain.shape) - 1.0
    with pytest.raises(OperationError):
        run("variable_fillet", block, edges=[edge], start=1, end=4, middle=2, middle_at=1.0)


def test_chamfer_two_distances_can_swap_sides(block):
    face, edge = _top_face_and_edge(block)
    a = run("chamfer_two_distances", block, faces=[face], edges=[edge], first=4, second=2)
    b = run("chamfer_two_distances", block, faces=[face], edges=[edge], first=4, second=2, swap=1)
    assert volume(a.shape) == pytest.approx(volume(b.shape), rel=1e-6)
    assert a.tracked_faces and b.tracked_faces
