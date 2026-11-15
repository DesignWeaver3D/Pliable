"""An operation that names the bodies it changed gives the result of the whole-model merge (mergescope.py)."""

import math

from OCP.BRep import BRep_Builder, BRep_Tool
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepGProp import BRepGProp
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeSphere
from OCP.GProp import GProp_GProps
from OCP.TopoDS import TopoDS_Compound
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt

from pliable.facemerge import merge_faces
from pliable.mergescope import changed_solids, merge_settled
from pliable.ops import OpResult, solids_of
from pliable.tools import Selection, get_tool
from pliable.topology import Topology
import pliable.tools  # noqa: F401  (registers the tools)

Z, Y = gp_Dir(0, 0, 1), gp_Dir(0, 1, 0)


def compound(solids):
    out, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(out)
    for solid in solids:
        builder.Add(out, solid)
    return out


def box(x):
    return BRepPrimAPI_MakeBox(gp_Pnt(x, 0, 0), gp_Pnt(x + 10, 10, 10)).Shape()


def split_cavity(x):
    """A block with a spherical cavity whose two halves were made apart: the kernel leaves them as two faces."""
    block = BRepPrimAPI_MakeBox(gp_Pnt(x, 0, 0), gp_Pnt(x + 20, 20, 8)).Shape()
    lower = BRepAlgoAPI_Cut(BRepPrimAPI_MakeBox(gp_Pnt(x, 0, 0), gp_Pnt(x + 20, 20, 4)).Shape(), BRepPrimAPI_MakeSphere(gp_Ax2(gp_Pnt(x + 10, 10, 4), Z), 3).Shape()).Shape()
    upper = BRepAlgoAPI_Cut(BRepPrimAPI_MakeBox(gp_Pnt(x, 0, 4), gp_Pnt(x + 20, 20, 8)).Shape(), BRepPrimAPI_MakeSphere(gp_Ax2(gp_Pnt(x + 10, 10, 4), Z, Y), 3).Shape()).Shape()
    return BRepAlgoAPI_Fuse(lower, upper).Shape()


def spheres(shape):
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_Sphere

    return sum(1 for _, f in Topology(shape).faces() if BRepAdaptor_Surface(f).GetType() == GeomAbs_Sphere)


def fingerprint(shape):
    """Everything a page could see of a model: per face id its area and centroid, per edge id its length, the solids."""
    topology = Topology(shape)
    faces, edges, vertices = [], [], []
    for _, face in topology.faces():
        props = GProp_GProps()
        BRepGProp.SurfaceProperties_s(face, props)
        c = props.CentreOfMass()
        faces.append((round(props.Mass(), 6), round(c.X(), 6), round(c.Y(), 6), round(c.Z(), 6)))
    for _, edge in topology.edges():
        props = GProp_GProps()
        BRepGProp.LinearProperties_s(edge, props)
        edges.append(round(props.Mass(), 6))
    for _, vertex in topology.vertices():
        point = BRep_Tool.Pnt_s(vertex)
        vertices.append((round(point.X(), 6), round(point.Y(), 6), round(point.Z(), 6)))
    return topology.face_count, topology.edge_count, topology.vertex_count, faces, edges, vertices, len(solids_of(shape))


def merged_model(shape):
    """The model as the document holds it after an operation: merged as a whole."""
    return merge_faces(OpResult(shape, [])).shape


def moved(topology, scoped, body=1, dx=3.0):
    topology.merged = scoped
    tool = get_tool("move_body")
    result = tool.execute(topology, Selection(bodies=[topology.bodies.bodies[body].id]), {"dx": dx, "dy": 0, "dz": 0}, preview=False)
    return result


def check_same(shape):
    shape = merged_model(shape)
    whole = moved(Topology(shape), False)
    scoped = moved(Topology(shape), True)
    assert fingerprint(scoped.shape) == fingerprint(whole.shape)
    return whole, scoped


def test_a_move_in_a_merged_model_is_the_whole_model_result_when_nothing_merges():
    check_same(compound([box(0), box(30), box(60), box(90)]))


def test_a_move_in_a_merged_model_is_the_whole_model_result_when_the_moved_body_merges():
    plain = compound([box(0), split_cavity(30), box(60)])
    # a model merged by an earlier operation, then the cavity body given two sphere faces again (as another operation could)
    shape = compound([solids_of(merged_model(plain))[0], solids_of(plain)[1], solids_of(merged_model(plain))[2]])
    whole = moved(Topology(shape), False, body=1)
    scoped = moved(Topology(shape), True, body=1)
    assert fingerprint(scoped.shape) == fingerprint(whole.shape)
    # the moved body's two cavity halves became one face in both
    assert spheres(whole.shape) == spheres(scoped.shape) == 1 < spheres(shape)


def test_an_unmerged_model_is_merged_as_a_whole():
    shape = compound([box(0), split_cavity(30), box(60)])
    topology = Topology(shape)
    topology.merged = False
    assert changed_solids(topology, {0}) is None
    result = moved(topology, False, body=0)  # the cavity body is not the moved one, and still merges
    assert Topology(result.shape).face_count < Topology(shape).face_count
    assert not result.merged  # the merge changed the model, so it is not yet known to be settled


def test_changed_solids_names_the_bodies_only_for_a_merged_model_of_separate_bodies():
    topology = Topology(compound([box(0), box(30), box(60)]))
    assert changed_solids(topology, {1}) is None  # not known to be merged
    topology.merged = True
    assert changed_solids(topology, {1}) == frozenset({1})
    assert changed_solids(topology, {0, 1, 2}) is None  # all of them: the whole model
    assert changed_solids(topology, set()) is None


def test_merge_faces_with_changed_bodies_equals_the_whole_merge():
    shape = compound([box(0), split_cavity(30), box(60)])
    for changed in (frozenset({1}), frozenset({0}), frozenset({0, 2})):
        whole = merge_faces(OpResult(shape, []))
        scoped = merge_faces(OpResult(shape, []), changed=changed)
        if 1 in changed:
            assert fingerprint(scoped.shape) == fingerprint(whole.shape)


def test_a_merge_that_changes_nothing_settles_the_model():
    shape = merged_model(compound([box(0), box(30)]))
    for _ in range(3):  # the merge may take a few passes to stop changing the model
        again = merge_faces(OpResult(shape, [])).shape
        if merge_settled(Topology(shape), again):
            break
        shape = again
    else:
        raise AssertionError("never settled")
    assert merge_settled(Topology(shape), merge_faces(OpResult(shape, [])).shape)
    assert not merge_settled(Topology(compound([split_cavity(0)])), merge_faces(OpResult(compound([split_cavity(0)]), [])).shape)


def test_a_move_flags_the_model_only_when_the_merge_settled():
    shape = compound([box(0), split_cavity(30), box(60)])
    first = moved(Topology(shape), False, body=0)
    assert not first.merged  # the cavity body merged: the merge changed the model
    steady = first.shape
    for _ in range(4):
        result = moved(Topology(steady), False, body=0)
        steady = result.shape
        if result.merged:
            break
    assert result.merged


def test_a_move_that_finds_the_model_merged_lets_the_next_one_merge_only_its_bodies():
    topology = Topology(merged_model(compound([box(0), box(30), box(60), box(90)])))
    topology.merged = False  # as after an import: merged in fact, not yet known to be
    moved(topology, False, body=1)
    assert topology.merged  # a preview counts: nothing was merged, so the model it started from is settled
    assert changed_solids(topology, {1}) == frozenset({1})
    unmerged = Topology(compound([box(0), split_cavity(30), box(60)]))
    moved(unmerged, False, body=0)
    assert not unmerged.merged  # the merge changed the other body, so nothing is known
