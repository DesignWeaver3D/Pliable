"""Tools other than Move/Rotate that change some bodies give the whole-model merge result when the merge is limited to them."""

from OCP.gp import gp_Pnt

from pliable.facemerge import merge_faces
from pliable.mergescope import changed_between
from pliable.ops import OpResult, solids_of
from pliable.tools import Selection, get_tool
from pliable.topology import Topology
from test_merge_scope import box, compound, fingerprint, merged_model, split_cavity


def sorted_fingerprint(shape):
    count_f, count_e, count_v, faces, edges, vertices, solid_count = fingerprint(shape)
    return count_f, count_e, count_v, sorted(faces), sorted(edges), sorted(vertices), solid_count


def run(shape, scoped, tool, selection_of, params):
    topology = Topology(shape)
    topology.merged = scoped
    return get_tool(tool).execute(topology, selection_of(topology), params, preview=False)


def top_face(topology, body):
    solid = solids_of(topology.shape)[body]
    return next(i for i, f in topology.faces() if topology.face_id(f) is not None and any(f.IsSame(g) for _, g in Topology(solid).faces()) and abs(_centre_z(f) - 10) < 1e-6)


def _centre_z(face):
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps

    props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(face, props)
    return props.CentreOfMass().Z()


def model():
    return merged_model(compound([box(0), box(30), box(60), box(90)]))


def test_changed_between_names_the_bodies_that_are_not_the_same():
    shape = model()
    solids = solids_of(shape)
    assert changed_between(shape, shape) == frozenset()
    assert changed_between(shape, compound([solids[0], box(30), solids[2], solids[3]])) == frozenset({1})
    assert changed_between(shape, compound(solids[:3])) == frozenset()  # a body that is gone leaves the others as they were


def test_a_hole_in_a_merged_model_is_the_whole_model_result():
    shape = model()
    topology = Topology(shape)
    face = top_face(topology, 1)
    pick = lambda t: Selection(faces=[face])
    whole = run(shape, False, "add_hole", pick, {"diameter": 3, "depth": 4})
    scoped = run(shape, True, "add_hole", pick, {"diameter": 3, "depth": 4})
    assert sorted_fingerprint(scoped.shape) == sorted_fingerprint(whole.shape)
    assert scoped.merged  # merged scoped to the changed body


def test_a_hole_in_an_unmerged_model_is_merged_as_a_whole():
    shape = compound([box(0), split_cavity(30), box(60)])
    topology = Topology(shape)
    face = top_face(topology, 0)
    result = run(shape, False, "add_hole", lambda t: Selection(faces=[face]), {"diameter": 3, "depth": 4})
    assert Topology(result.shape).face_count < Topology(shape).face_count + 4  # the cavity body merged too


def test_scale_and_offset_in_a_merged_model_are_the_whole_model_result():
    shape = model()
    for tool, params in (("scale_body", {"factor": 1.5}), ("offset_body", {"distance": 1.0})):
        pick = lambda t: Selection(bodies=[t.bodies.bodies[2].id])
        whole = run(shape, False, tool, pick, params)
        scoped = run(shape, True, tool, pick, params)
        assert sorted_fingerprint(scoped.shape) == sorted_fingerprint(whole.shape), tool
        assert scoped.merged, tool


def test_a_narrowed_run_does_not_claim_the_others_are_merged():
    shape = model()
    topology = Topology(shape)
    topology.merged = False
    face = top_face(topology, 1)
    result = get_tool("add_hole").execute(topology, Selection(faces=[face]), {"diameter": 3, "depth": 4}, preview=False)
    assert not result.merged


def stacked():
    """Two bodies one on the other (a hole through both changes both) beside two others, merged as the document holds it."""
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox

    upper = BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 10), gp_Pnt(10, 10, 20)).Shape()
    return merged_model(compound([box(0), upper, box(30), box(60)]))


def test_changed_between_ignores_the_order_the_bodies_come_back_in():
    shape = model()
    solids = solids_of(shape)
    assert changed_between(shape, compound([solids[2], solids[0], solids[3], solids[1]])) == frozenset()
    assert changed_between(shape, compound([solids[2], box(30), solids[3], solids[0]])) == frozenset({1})


def test_changed_between_names_the_parts_of_a_body_that_was_split():
    shape = model()
    solids = solids_of(shape)
    assert changed_between(shape, compound([solids[0], box(30), box(40), solids[2], solids[3]])) == frozenset({1, 2})


def test_a_hole_in_other_bodies_in_a_merged_model_is_the_whole_model_result(monkeypatch):
    import pliable.mergescope as scope

    shape = stacked()
    asked = []
    original = scope.merge_faces
    monkeypatch.setattr(scope, "merge_faces", lambda result, changed=None, **k: (asked.append(changed), original(result, changed=changed, **k))[1])
    topology = Topology(shape)
    face = next(i for i, f in topology.faces() if abs(_centre_z(f) - 20) < 1e-6)
    results = []
    for scoped in (False, True):
        t = Topology(shape)
        t.merged = scoped
        t.interact = "others"
        results.append(get_tool("add_hole").execute(t, Selection(faces=[face]), {"diameter": 3, "depth": 0}, preview=False))
    whole, scoped = results
    assert len(solids_of(whole.shape)) == 4
    assert Topology(whole.shape).face_count == Topology(shape).face_count + 2  # the hole went through both bodies
    assert asked == [None, frozenset({0, 1})]  # the whole model, then only the two bodies it cut
    assert sorted_fingerprint(scoped.shape) == sorted_fingerprint(whole.shape)
    assert scoped.merged and whole.merged  # the bodies it did not touch were left as they were by the merge, so the next operation can be scoped


def test_a_merge_that_changes_only_the_changed_bodies_settles_the_rest():
    from pliable.mergescope import settled_beside

    shape = compound([box(0), split_cavity(30), box(60)])
    merged = merge_faces(OpResult(shape, [])).shape
    assert settled_beside(shape, merged, frozenset({1}))  # only the cavity body changed in the merge
    assert not settled_beside(shape, merged, frozenset({0}))  # a body outside the changed ones changed


def test_a_second_hole_through_the_same_bodies_is_merged_scoped(monkeypatch):
    import pliable.mergescope as scope
    from pliable.bodydisplay import body_ranges

    def drill(shape, merged, offset):
        t = Topology(shape)
        t.merged = merged
        t.interact = "others"
        face = next(i for i, f in t.faces() if abs(_centre_z(f) - 20) < 1e-6)
        return get_tool("add_hole").execute(t, Selection(faces=[face]), {"diameter": 2, "depth": 0, "offset_u": offset}, preview=False)

    first = merged_model(drill(stacked(), False, 0.0).shape)
    assert body_ranges(Topology(first), solids_of(first)) is not None  # the bodies cut together still hold nothing in common
    asked = []
    original = scope.merge_faces
    monkeypatch.setattr(scope, "merge_faces", lambda result, changed=None, **k: (asked.append(changed), original(result, changed=changed, **k))[1])
    whole, scoped = drill(first, False, 3.0), drill(first, True, 3.0)
    assert sorted_fingerprint(scoped.shape) == sorted_fingerprint(whole.shape)
    assert asked == [None, frozenset({0, 1})]


def test_a_tool_that_only_calls_finish_gets_the_scoped_merge():
    shape = model()
    topology = Topology(shape)
    face = top_face(topology, 1)
    pick = lambda t: Selection(faces=[face])
    whole = run(shape, False, "add_boss", pick, {"diameter": 4, "height": 5})
    scoped = run(shape, True, "add_boss", pick, {"diameter": 4, "height": 5})
    assert sorted_fingerprint(scoped.shape) == sorted_fingerprint(whole.shape)
    assert scoped.merged  # no tool asks for the scoped merge: the tool runner sets it for every tool
