"""A tool whose shape crosses several bodies removes or adds what the shape covers, no more and no less.

The model is five separate bodies: A and B touch (A below), C stands above B, D floats above C, E is far away. With `overlap` C
reaches down into B and D down into C's top (an import can hold overlapping bodies). The check is independent of the tool's own boolean: a cut must
remove, from each body the setting allows, exactly the volume the tool shape shares with that body and leave none of the tool's volume inside any body;
a join must give the volume of the union of the bodies and the tool. Each tool runs with the "This body / Other bodies" choice where it has one.
Failures are marked expected to fail with the reason (they are recorded in docs/agent-notes/tool-audit.md).
"""

import pytest
from build123d import Box, Pos
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common, BRepAlgoAPI_Fuse
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeRevol
from OCP.Bnd import Bnd_Box
from OCP.gp import gp_Ax1, gp_Ax2, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec

from pliable.body_scope import _compound
from pliable.ops import _faces_of, planar_normal, solids_of
from pliable.tools import Selection, get_tool
from pliable.topology import Topology
from pliable.volume import volume_of

A, B, C, D, E = range(5)
TOL = 0.5  # mm3, on volumes of about 1e3 to 1e5


class Z:
    """Heights of the bodies of the model: C and D from `c0` to `c1` and `d0` to `d1`."""

    def __init__(self, overlap):
        self.c0, self.c1 = (17, 37) if overlap else (25, 45)
        self.d0, self.d1 = (40, 50) if overlap else (50, 60)


def scene(overlap=False):
    z = Z(overlap)
    return Topology(_compound([
        (Pos(0, 0, 5) * Box(40, 40, 10)).wrapped,  # A  z 0..10
        (Pos(0, 0, 15) * Box(40, 40, 10)).wrapped,  # B  z 10..20, touches A
        (Pos(8, 0, (z.c0 + z.c1) / 2) * Box(20, 20, 20)).wrapped,  # C  x -2..18
        (Pos(0, 0, (z.d0 + z.d1) / 2) * Box(40, 40, 10)).wrapped,  # D
        (Pos(100, 0, 5) * Box(40, 40, 10)).wrapped,  # E  far away
    ]))


def face_of(topology, body, nz, low=False):
    """The planar face of one body facing +Z (nz > 0) or -Z, the highest of them (`low`: the lowest)."""
    solid = solids_of(topology.shape)[body]
    found = []
    for i, face in topology.faces():
        if not any(face.IsSame(f) for f in _faces_of(solid)):
            continue
        normal = planar_normal(face)
        if normal is None or normal.Z() * nz < 0.9:
            continue
        box = Bnd_Box()
        BRepBndLib.Add_s(face, box)
        found.append((box.CornerMin().Z(), i))
    return (min if low else max)(found)[1]


def vol(shape) -> float:
    return abs(volume_of(shape)) if shape is not None and not shape.IsNull() else 0.0


def common(a, b) -> float:
    op = BRepAlgoAPI_Common(a, b)
    return vol(op.Shape()) if op.IsDone() else 0.0


def union_volume(shapes) -> float:
    total = shapes[0]
    for s in shapes[1:]:
        op = BRepAlgoAPI_Fuse(total, s)
        assert op.IsDone()
        total = op.Shape()
    return vol(total)


def box_tool(x0, y0, z0, x1, y1, z1):
    return BRepPrimAPI_MakeBox(gp_Pnt(x0, y0, z0), gp_Pnt(x1, y1, z1)).Shape()


def cylinder_tool(x, y, z0, z1, radius):
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x, y, z0), gp_Dir(0, 0, 1)), radius, z1 - z0).Shape()


def run(tool_id, selection, params, interact=None, overlap=False, model=None):
    model = model or scene(overlap)
    model.interact = interact
    before = solids_of(model.shape)
    result = get_tool(tool_id).execute(model, selection(model), params, preview=False)
    return before, solids_of(result.shape)


def reach(interact, owner):
    """The positions of the bodies the tool may change: all of them, or the owner only."""
    return set(range(5)) if interact == "others" else {owner}


def same_body(a, b) -> bool:
    """The very body, or a rebuilt one of the same volume and bounds (a merge hands back new shapes)."""
    if a.IsSame(b):
        return True
    boxes = []
    for s in (a, b):
        box = Bnd_Box()
        BRepBndLib.Add_s(s, box)
        boxes.append(box)
    near = lambda p, q: all(abs(x - y) < 1e-4 for x, y in zip((p.X(), p.Y(), p.Z()), (q.X(), q.Y(), q.Z())))
    return abs(vol(a) - vol(b)) < 1e-6 and near(boxes[0].CornerMin(), boxes[1].CornerMin()) and near(boxes[0].CornerMax(), boxes[1].CornerMax())


def check_cut(before, after, tool, interact, owner):
    assert all(vol(a) > TOL for a in after), "a solid of no volume was left in the model"
    allowed = reach(interact, owner)
    expected = sum(common(b, tool) for i, b in enumerate(before) if i in allowed)
    removed = sum(vol(b) for b in before) - sum(vol(a) for a in after)
    inside = sum(common(a, tool) for a in after)
    outside_reach = sum(common(b, tool) for i, b in enumerate(before) if i not in allowed)
    assert abs(removed - expected) < TOL, f"removed {removed:.1f} mm3, the tool covers {expected:.1f} mm3 of the bodies it may cut"
    assert inside - outside_reach < TOL, f"{inside - outside_reach:.1f} mm3 of material left inside the tool shape"


def check_join(before, after, tool, interact, owner):
    assert all(vol(a) > TOL for a in after), "a solid of no volume was left in the model"
    allowed = reach(interact, owner)
    joined = union_volume([b for i, b in enumerate(before) if i in allowed] + [tool])
    left_alone = [b for i, b in enumerate(before) if i not in allowed]
    made = [a for a in after if not any(same_body(a, b) for b in left_alone)]
    assert len(after) - len(made) == len(left_alone), "a body the setting keeps out was changed"
    made_volume = union_volume(made) if made else 0.0
    assert abs(made_volume - joined) < TOL, f"the joined bodies hold {made_volume:.1f} mm3, the bodies and the tool union to {joined:.1f} mm3"
    spare = lambda shapes: sum(vol(s) for s in shapes) - union_volume(shapes) if shapes else 0.0  # volume held twice by overlapping solids
    assert spare(made) <= spare([b for i, b in enumerate(before) if i in allowed]) + TOL, "the joined material is held twice (overlapping solids)"


def known(request, reasons):
    """Mark this case expected to fail with the recorded reason when its parameters are in `reasons` (a failure found by the audit, not yet fixed)."""
    params = request.node.callspec.params
    key = tuple(params.get(k) for k in ("interact", "overlap", "mode"))
    reason = reasons.get(key)
    if reason:
        request.applymarker(pytest.mark.xfail(reason=reason, strict=True))


PULL_OTHERS = "Pull with Other bodies fuses the prism into the pulled body only: the bodies it crosses stay in place overlapping it (16,000 mm3 held twice)"
INTERACT = ("this", "others")
OVERLAP = (False, True)
cases = pytest.mark.parametrize("overlap", OVERLAP, ids=("apart", "overlap"))
sides = pytest.mark.parametrize("interact", INTERACT)


@cases
@sides
def test_push_pull_pull_joins_what_it_covers(request, interact, overlap):
    known(request, {("others", False, None): PULL_OTHERS, ("others", True, None): PULL_OTHERS})
    z = Z(overlap)
    before, after = run("push_pull", lambda m: Selection(faces=[face_of(m, D, -1, low=True)]), {"distance": z.d0 - 15}, interact, overlap)
    check_join(before, after, box_tool(-20, -20, 15, 20, 20, z.d0), interact, D)


@sides
def test_push_pull_push_cuts_what_it_covers(interact):  # a push cuts the bodies it reaches body by body (pushpull.py): correct
    """Only where C overlaps B: a push of C's top reaches into B."""
    overlap = True
    z = Z(overlap)
    before, after = run("push_pull", lambda m: Selection(faces=[face_of(m, C, 1)]), {"distance": -(z.c1 - 19)}, interact, overlap)
    check_cut(before, after, box_tool(-2, -10, 19, 18, 10, z.c1), interact, C)


@cases
@sides
def test_hole_through_cuts_what_it_covers(interact, overlap):  # cut body by body (shared/bodycut.py): correct
    before, after = run("add_hole", lambda m: Selection(faces=[face_of(m, D, 1)]), {"diameter": 6, "depth": 0}, interact, overlap)
    check_cut(before, after, cylinder_tool(0, 0, -5, 70, 3), interact, D)


@cases
@sides
def test_hole_blind_cuts_what_it_covers(interact, overlap):
    z = Z(overlap)
    before, after = run("add_hole", lambda m: Selection(faces=[face_of(m, D, 1)]), {"diameter": 6, "depth": z.d1 - 17}, interact, overlap)
    check_cut(before, after, cylinder_tool(0, 0, 17, z.d1, 3), interact, D)


@cases
@sides
def test_boss_joins_what_it_covers(request, interact, overlap):
    z = Z(overlap)
    before, after = run("add_boss", lambda m: Selection(faces=[face_of(m, D, -1, low=True)]), {"diameter": 6, "height": z.d0 - 10}, interact, overlap)
    check_join(before, after, cylinder_tool(0, 0, 10, z.d0, 3), interact, D)


@cases
@sides
def test_slot_through_cuts_what_it_covers(interact, overlap):  # cut body by body (shared/bodycut.py): correct
    before, after = run("add_slot", lambda m: Selection(faces=[face_of(m, D, 1)]), {"length": 20, "width": 6, "depth": 0}, interact, overlap)
    ends = BRepAlgoAPI_Fuse(cylinder_tool(-7, 0, -5, 70, 3), cylinder_tool(7, 0, -5, 70, 3)).Shape()
    check_cut(before, after, BRepAlgoAPI_Fuse(box_tool(-7, -3, -5, 7, 3, 70), ends).Shape(), interact, D)


def ring_scene():
    """A source body Q beside three posts on a ring about the Z axis: sweeping Q's face a half turn crosses two of them."""
    boxes = [
        (Pos(-18, -8, 20) * Box(2, 10, 30)).wrapped,  # Q, its +X face at x = -17 (set off to one side: a face that straddles the line nearest the axis sweeps over itself and is no valid solid)
        (Pos(0, -18, 20) * Box(10, 10, 40)).wrapped,  # P1 on the sweep
        (Pos(18, 0, 20) * Box(10, 10, 40)).wrapped,  # P2 on the sweep
        (Pos(3, -21, 20) * Box(10, 10, 40)).wrapped,  # P3 overlaps P1, also on the sweep
        (Pos(100, 0, 20) * Box(10, 10, 40)).wrapped,  # P4 far away
    ]
    return Topology(_compound(boxes))


def right_face(model, body):
    """The planar face of one body that faces +X, the nearest one to the axis."""
    solid = solids_of(model.shape)[body]
    for i, face in model.faces():
        if any(face.IsSame(f) for f in _faces_of(solid)):
            normal = planar_normal(face)
            if normal is not None and normal.X() > 0.9:
                return i
    raise AssertionError("no +X face")


@pytest.mark.parametrize("mode", (0, 1), ids=("add", "subtract"))
@sides
def test_revolve_covers_what_it_sweeps(request, interact, mode):
    if interact == "this" and mode == 1:
        pytest.skip("the swept shape meets no part of its own body: the tool refuses, as it should")
    model = ring_scene()
    face = model.face(right_face(model, 0))
    tool = BRepPrimAPI_MakeRevol(face, gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 3.141592653589793).Shape()
    before, after = run("revolve_face", lambda m: Selection(faces=[right_face(m, 0)]), {"axis": 2, "angle": 180, "mode": mode}, interact, model=model)
    (check_join if mode == 0 else check_cut)(before, after, tool, interact, 0)


@pytest.mark.parametrize("mode,name", ((0, "union"), (1, "subtract")))
def test_body_boolean_changes_only_the_chosen_bodies(mode, name):
    model = scene()
    ids = [model.bodies.bodies[B].id, model.bodies.bodies[C].id]
    before, after = run("body_boolean", lambda m: Selection(bodies=ids), {"mode": mode}, model=model)
    expect = union_volume([before[B], before[C]]) if mode == 0 else vol(before[B]) - common(before[B], before[C])
    untouched = [before[A], before[D], before[E]]
    made = [a for a in after if not any(same_body(a, b) for b in untouched)]
    assert len(after) - len(made) == 3, "a body that was not chosen was changed"
    assert abs(sum(vol(a) for a in made) - expect) < TOL


@cases
def test_mirror_joins_the_copy_with_what_it_meets(overlap):
    model = scene(overlap)
    ids = [model.bodies.bodies[D].id]
    z = Z(overlap)
    mirror = gp_Trsf()
    plane = (z.d0 + z.d1) / 4  # the copy lands at z = d0 - 2 * plane + ... : mirror D about z = plane
    mirror.SetMirror(gp_Ax2(gp_Pnt(0, 0, plane), gp_Dir(0, 0, 1)))
    before, after = run("mirror", lambda m: Selection(bodies=ids), {"plane": 1, "offset": plane}, model=model)
    copy = BRepBuilderAPI_Transform(before[D], mirror, True).Shape()
    check_join(before, after, copy, "others", D)


@cases
def test_cylinder_primitive_joined_to_the_model_joins_what_it_covers(request, overlap):
    params = {"diameter": 6, "height": 80, "x": 0, "y": 0, "z": -5, "new_body": 0}
    before, after = run("add_cylinder", lambda m: Selection(), params, overlap=overlap)
    check_join(before, after, cylinder_tool(0, 0, -5, 75, 3), "others", D)


@cases
def test_linear_array_joins_the_copies_with_what_they_meet(overlap):
    z = Z(overlap)
    move = gp_Trsf()
    move.SetTranslation(gp_Vec(5, 0, z.d0 - z.c0 + 3))  # the copy of C reaches up into D
    before, after = run("linear_array", lambda m: Selection(faces=[face_of(m, C, 1)]), {"count": 2, "dx": 5, "dz": z.d0 - z.c0 + 3, "rows": 1}, overlap=overlap)
    check_join(before, after, BRepBuilderAPI_Transform(before[C], move, True).Shape(), "others", C)


def sweep_scene():
    """The source body Q (its +X face at x = -17), two overlapping posts S1 and S2 in the way of a sweep along +X, and a long bar F whose edge is the path."""
    return Topology(_compound([
        (Pos(-18, -8, 20) * Box(2, 10, 30)).wrapped,  # Q
        (Pos(5, -6, 20) * Box(10, 14, 40)).wrapped,  # S1 x 0..10
        (Pos(11, -6, 20) * Box(10, 14, 40)).wrapped,  # S2 x 6..16, overlapping S1
        (Pos(100, 0, 5) * Box(10, 10, 10)).wrapped,  # far away
        (Pos(100, 50, 5) * Box(60, 10, 10)).wrapped,  # F: the path is one of its edges that run along +X
    ]))


def path_edge(model, body):
    """The edge of one body running along +X from its first to its last vertex (60 long), and the swept distance."""
    from OCP.BRep import BRep_Tool
    from OCP.TopExp import TopExp

    solid = solids_of(model.shape)[body]
    for i, edge in model.edges():
        first, last = (BRep_Tool.Pnt_s(TopExp.FirstVertex_s(edge, True)), BRep_Tool.Pnt_s(TopExp.LastVertex_s(edge, True)))
        if abs(last.X() - first.X() - 60) < 1e-6 and abs(last.Y() - first.Y()) < 1e-6 and abs(last.Z() - first.Z()) < 1e-6 and any(edge.IsSame(e) for e in _edges_of(solid)):
            return i
    raise AssertionError("no edge along +X")


def _edges_of(shape):
    from OCP.TopAbs import TopAbs_EDGE
    from OCP.TopExp import TopExp_Explorer

    explorer, out = TopExp_Explorer(shape, TopAbs_EDGE), []
    while explorer.More():
        out.append(explorer.Current())
        explorer.Next()
    return out


@pytest.mark.parametrize("mode", (0, 1), ids=("add", "subtract"))
def test_sweep_face_with_other_bodies_covers_what_it_sweeps(request, mode):
    """Subtract: the pipe of the face along the edge is cut out of every body it crosses, overlapping ones included."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeWire
    from OCP.BRepOffsetAPI import BRepOffsetAPI_MakePipe

    model = sweep_scene()
    edge = model.edge(path_edge(model, 4))
    pipe = BRepOffsetAPI_MakePipe(BRepBuilderAPI_MakeWire(edge).Wire(), model.face(right_face(model, 0))).Shape()
    before, after = run("sweep_face", lambda m: Selection(faces=[right_face(m, 0)], edges=[path_edge(m, 4)]), {"mode": mode}, "others", model=model)
    (check_join if mode == 0 else check_cut)(before, after, pipe, "others", 0)


def helix_scene():
    """A small source body Q on the +X side of the Z axis (its -Y face lies in the plane y = 0 that holds the axis), a post on the coil's way at 90 degrees with another overlapping it, and a far post."""
    return Topology(_compound([
        (Pos(18, 5, 12) * Box(4, 10, 4)).wrapped,  # Q, its -Y face x 16..20, z 10..14
        (Pos(0, 18, 20) * Box(10, 10, 40)).wrapped,  # P1 on the coil
        (Pos(3, 21, 20) * Box(10, 10, 40)).wrapped,  # P2 overlapping P1
        (Pos(-18, -2, 20) * Box(10, 10, 40)).wrapped,  # P3 on the coil at 180 degrees
        (Pos(100, 0, 20) * Box(10, 10, 40)).wrapped,  # P4 far away
    ]))


def test_helical_sweep_subtract_with_other_bodies_covers_what_it_winds():
    model = helix_scene()
    solid = solids_of(model.shape)[0]
    face_id = next(i for i, f in model.faces() if any(f.IsSame(g) for g in _faces_of(solid)) and (lambda n: n is not None and n.Y() < -0.9)(planar_normal(f)))
    tool = get_tool("helical_sweep")
    params = {"mode": 1, "pitch": 8, "turns": 2, "axis": 2}
    coils = tool._coil(model.face(face_id), tool._axis(model, Selection(faces=[face_id]), tool.bind(params)), tool.bind(params))
    before, after = run("helical_sweep", lambda m: Selection(faces=[face_id]), params, "others", model=model)
    check_cut(before, after, _compound(coils), "others", 0)


def test_hole_to_slot_cuts_the_hole_owner_only():
    """A hole drilled through B, then stretched into a slot: the tool works on the body that owns the hole (scope_to_bodies) and leaves the bodies that overlap or touch B there (C, A) alone. Recorded as it is: the audit expected a whole-model cut."""
    from pliable.holes import find_hole
    from pliable.opserrors import OperationError

    _, drilled = run("add_hole", lambda m: Selection(faces=[face_of(m, B, 1)]), {"diameter": 6, "depth": 0}, "this", True)
    model = Topology(_compound(drilled))
    wall = None
    for i, _ in model.faces():
        try:
            find_hole(model, face_id=i, reach=False)
            wall = i
            break
        except OperationError:
            continue
    assert wall is not None
    margin = 0.01 * 10 + 1e-3  # the tool's lead-in beyond the hole's ends
    low, high = 10 - margin, 20 + margin
    tool = BRepAlgoAPI_Fuse(box_tool(0, -3, low, 10, 3, high), cylinder_tool(10, 0, low, high, 3)).Shape()
    model.interact = None
    before = solids_of(model.shape)
    result = get_tool("hole_to_slot").execute(model, Selection(faces=[wall]), {"dx": 10, "dy": 0, "dz": 0}, preview=False)
    check_cut(before, solids_of(result.shape), tool, "this", B)
