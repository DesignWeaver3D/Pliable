"""A tool that declares scope_to_bodies sees only the bodies its selection belongs to (body_scope.py)."""

import pytest
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps

from pliable.demos import load_demo
from pliable.document import Document
from pliable.ops import OperationError, planar_normal, solids_of
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


def first_of_body(topology, body_index, kind):
    """Scene id of the first face or edge (by id) that belongs to one body."""
    from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE
    from OCP.TopExp import TopExp
    from OCP.collections import IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher as ShapeIndexedMap

    mine = ShapeIndexedMap()
    TopExp.MapShapes_s(solids_of(topology.shape)[body_index], TopAbs_FACE if kind == "faces" else TopAbs_EDGE, mine)
    items = topology.faces() if kind == "faces" else topology.edges()
    return next(i for i, shape in items if mine.Contains(shape))


# (tool, what it is given, extra values) for the tools that work on the body owning the selection
SCOPED = [
    ("fillet_chamfer", "edges", {"distance": 2}),
    ("round_face", "faces", {"distance": 2}),
    ("divide_face", "faces", {}),
    ("inset_face", "faces", {}),
]


def _selection(kind, index):
    return Selection(**{kind: [index]})


def _params(tool, extra):
    return {p.name: p.default for p in tool.params} | extra


@pytest.mark.parametrize("body_index", [0, 1])
@pytest.mark.parametrize("tool_id,kind,extra", SCOPED)
def test_scoped_tools_ignore_a_copy_lying_on_the_body(block_with_copy, tool_id, kind, extra, body_index):
    from pliable.topology import Topology

    tool = get_tool(tool_id)
    assert tool.scope_to_bodies
    lone = Topology(solids_of(block_with_copy.shape)[0])
    alone = tool.execute(lone, _selection(kind, first_of_body(block_with_copy, 0, kind)), _params(tool, extra), preview=False)
    with_copy = tool.execute(block_with_copy, _selection(kind, first_of_body(block_with_copy, body_index, kind)), _params(tool, extra), preview=False)
    solids = solids_of(with_copy.shape)
    assert len(solids) == 2
    assert volume(solids[body_index]) == pytest.approx(volume(alone.shape), rel=1e-6)
    assert volume(solids[1 - body_index]) == pytest.approx(24000, rel=1e-6)


def _pull_top(scene, body_index, distance=10, **params):
    face = top_face_of(scene, body_index)
    return get_tool("push_pull").execute(scene, Selection(faces=[face]), {"distance": distance, **params}, preview=False)


def test_push_pull_leaves_a_hidden_copy_alone(block_with_copy):
    scene = block_with_copy
    scene.hidden_bodies = frozenset({scene.bodies.bodies[1].id})
    result = _pull_top(scene, 0)
    solids = solids_of(result.shape)
    assert len(solids) == 2
    assert volume(solids[0]) == pytest.approx(36000, rel=1e-6)
    assert volume(solids[1]) == pytest.approx(24000, rel=1e-6)  # the hidden copy is not fused or cut


def test_plain_push_leaves_other_bodies_alone(block_with_copy):
    solids = solids_of(_pull_top(block_with_copy, 0, -5).shape)
    assert [round(volume(s)) for s in solids] == [18000, 24000]


def block_with_body_above():
    from build123d import Box, Pos

    from pliable.topology import Topology

    from OCP.BRep import BRep_Builder
    from OCP.TopoDS import TopoDS_Compound

    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    builder.Add(compound, Box(40, 30, 20).wrapped)
    builder.Add(compound, (Pos(0, 0, 40) * Box(40, 30, 20)).wrapped)
    return Topology(compound)


@pytest.mark.parametrize("extent", ["last", "through"])
def test_pulling_up_to_a_body_merges_it_while_it_is_visible(extent):
    scene = block_with_body_above()
    result = _pull_top(scene, 0, 5, extent=extent)
    assert [round(volume(s)) for s in solids_of(result.shape)] == [72000]


@pytest.mark.parametrize("extent", ["last", "through"])
def test_pulling_up_to_a_hidden_body_does_not_see_it(extent):
    scene = block_with_body_above()
    scene.hidden_bodies = frozenset({scene.bodies.bodies[1].id})
    with pytest.raises(OperationError, match="nothing lies beyond"):
        _pull_top(scene, 0, 5, extent=extent)


def test_push_pull_new_body_never_merges_with_a_body_it_touches(block_with_copy):
    result = _pull_top(block_with_copy, 0, mode="new")
    solids = solids_of(result.shape)
    assert len(solids) == 3
    assert sorted(round(volume(s)) for s in solids) == [12000, 24000, 24000]


def _scene(*shapes):
    from OCP.BRep import BRep_Builder
    from OCP.TopoDS import TopoDS_Compound

    from pliable.topology import Topology

    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    for shape in shapes:
        builder.Add(compound, shape)
    return Topology(compound)


def _with_copy_of(shape):
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy

    return _scene(shape, BRepBuilderAPI_Copy(shape, True).Shape())


def test_a_new_hole_skips_a_hidden_copy_but_cuts_a_visible_one():
    from pliable.topology import Topology

    block = solids_of(Topology(load_demo("block")).shape)[0]
    for hidden, copy_volume in ((True, 24000), (False, None)):
        scene = _with_copy_of(block)
        if hidden:
            scene.hidden_bodies = frozenset({scene.bodies.bodies[1].id})
        result = get_tool("add_hole").execute(scene, Selection(faces=[top_face_of(scene, 0)]), {"diameter": 6, "depth": 0}, preview=False)
        solids = solids_of(result.shape)
        assert volume(solids[0]) < 24000 - 1  # the bore is in the body that was clicked
        if hidden:
            assert volume(solids[1]) == pytest.approx(copy_volume, rel=1e-6)
        else:
            assert volume(solids[1]) < 24000 - 1  # unchanged behavior: a visible body the bore meets is cut too


def _wall_of_body(topology, body_index):
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_Cylinder
    from OCP.TopAbs import TopAbs_FACE
    from OCP.TopExp import TopExp
    from OCP.collections import IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher as ShapeIndexedMap

    mine = ShapeIndexedMap()
    TopExp.MapShapes_s(solids_of(topology.shape)[body_index], TopAbs_FACE, mine)
    return next(i for i, f in topology.faces() if mine.Contains(f) and BRepAdaptor_Surface(f).GetType() == GeomAbs_Cylinder)


def test_resizing_a_hole_changes_only_its_own_body():
    from pliable.topology import Topology

    block = Topology(load_demo("block"))
    holed = get_tool("add_hole").execute(block, Selection(faces=[top_face_of(block, 0)]), {"diameter": 6, "depth": 0}, preview=False).shape
    holed_volume = volume(holed)
    scene = _with_copy_of(solids_of(holed)[0])
    result = get_tool("resize_hole").execute(scene, Selection(faces=[_wall_of_body(scene, 0)]), {"diameter": 10}, preview=False)
    solids = solids_of(result.shape)
    assert len(solids) == 2
    assert volume(solids[0]) < holed_volume - 1  # a wider hole removes more
    assert volume(solids[1]) == pytest.approx(holed_volume, rel=1e-6)  # the copy keeps its hole


def _region_above_block(shape, toward):
    """`shape` plus a circular region 5 above the top of the block (z 15), facing into the block when `toward`. Returns the
    topology and the region's face id."""
    from pliable import sketch
    from pliable.topology import Topology

    sign = -1 if toward else 1
    plane = {"origin": [0, 0, 15], "normal": [0, 0, sign], "xdir": [1, 0, 0]}
    sk = {"plane": plane, "points": [{"id": 1, "u": 0, "v": 0}], "entities": [{"id": 10, "type": "circle", "center": 1, "radius": 2}], "constraints": []}
    with_region, _ = sketch.add_regions(shape, sk)
    scene = Topology(with_region)
    face = scene.face_id(_loose_of(scene))
    return scene, face


def _loose_of(scene):
    from pliable.body_scope import _loose_faces

    (face,) = _loose_faces(scene, solids_of(scene.shape))
    return face


def test_loose_faces_go_into_the_narrowed_scene_and_come_back():
    from pliable.body_scope import _loose_faces, narrow
    from pliable.topology import Topology

    base = _with_copy_of(solids_of(Topology(load_demo("block")).shape)[0])
    scene, region = _region_above_block(base.shape, toward=True)
    selection = Selection(faces=[top_face_of(scene, 0)])
    held = narrow(scene, selection)  # strict: a tool working on a body does not see the region, it comes back as it was
    assert len(solids_of(held.topology.shape)) == 1 and held.topology.face_count == 6 and len(held.held_out) == 1
    assert len(solids_of(held.widen(OpResult_of(held.topology.shape)).shape)) == 2
    scene.hidden_bodies = frozenset({scene.bodies.bodies[1].id})
    merging = narrow(scene, selection, strict=False)  # a tool that merges gets the region too, and not the hidden body
    assert len(solids_of(merging.topology.shape)) == 1 and len(merging.loose_faces) == 1 and merging.held_out == []
    narrowed = narrow(scene, Selection(faces=[region, top_face_of(scene, 0)]))
    assert narrowed.held_out == [] and len(narrowed.loose_faces) == 1 and narrowed.topology.face_count == 6 + 1
    widened = narrowed.widen(OpResult_of(narrowed.topology.shape))
    assert len(solids_of(widened.shape)) == 2
    assert len(_loose_faces(Topology(widened.shape), solids_of(widened.shape))) == 1


def OpResult_of(shape):
    from pliable.ops import OpResult

    return OpResult(shape, {})


def test_a_selected_loose_face_has_no_owner_so_strict_scoping_sees_the_whole_scene():
    from pliable.body_scope import narrow
    from pliable.topology import Topology

    base = _with_copy_of(solids_of(Topology(load_demo("block")).shape)[0])
    scene, region = _region_above_block(base.shape, toward=True)
    assert narrow(scene, Selection(faces=[region])) is None
    narrowed = narrow(scene, Selection(faces=[region, top_face_of(scene, 1)]))
    assert narrowed is not None and len(solids_of(narrowed.topology.shape)) == 1


def test_a_hidden_body_beside_a_loose_region_is_not_fused_or_cut_by_pulling_it():
    from pliable.topology import Topology

    scene, region = _region_above_block(solids_of(Topology(load_demo("block")).shape)[0], toward=True)
    pull = get_tool("push_pull")
    visible = pull.execute(scene, Selection(faces=[region]), {"distance": 7}, preview=False)
    assert len(solids_of(visible.shape)) == 1  # the pulled cylinder joins the block
    scene.hidden_bodies = frozenset({scene.bodies.bodies[0].id})
    hidden = pull.execute(scene, Selection(faces=[region]), {"distance": 7}, preview=False)
    volumes = sorted(round(volume(s)) for s in solids_of(hidden.shape))
    assert len(volumes) == 2 and 24000 in volumes  # the hidden block is untouched, the cylinder is its own body


def test_shelling_a_body_next_to_a_loose_region_keeps_the_region():
    from pliable.body_scope import _loose_faces
    from pliable.topology import Topology

    scene, region = _region_above_block(solids_of(Topology(load_demo("block")).shape)[0], toward=True)
    top = top_face_of(scene, 0)
    result = get_tool("shell").execute(scene, Selection(faces=[top]), _params(get_tool("shell"), {"thickness": 2}), preview=False)
    assert len(solids_of(result.shape)) == 1
    assert volume(result.shape) < 24000
    assert len(_loose_faces(Topology(result.shape), solids_of(result.shape))) == 1


def test_a_shelled_body_keeps_its_own_id_and_name_next_to_its_copy():
    document = Document(load_demo("block"))
    original_id = document.current.bodies.bodies[0].id
    _, copy_id = document.duplicate_body(original_id)
    scene = document.current
    result = get_tool("shell").execute(scene, Selection(faces=[top_face_of(scene, 0)]), {"thickness": 2}, preview=False)
    after = document.commit(result.shape).bodies.bodies
    assert [b.id for b in after] == [original_id, copy_id]
    assert after[1].name.endswith(" copy") and not after[0].name.endswith(" copy")
    assert volume(solids_of(document.current.shape)[1]) == pytest.approx(24000, rel=1e-6)  # the copy is the untouched one
