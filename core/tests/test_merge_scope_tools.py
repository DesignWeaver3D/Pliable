"""Tools other than Move/Rotate that change some bodies give the whole-model merge result when the merge is limited to them."""

from OCP.gp import gp_Pnt

from pliable.mergescope import changed_between
from pliable.ops import solids_of
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
    assert changed_between(shape, compound(solids[:3])) is None


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
