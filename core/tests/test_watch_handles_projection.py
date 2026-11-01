"""Watch list corners: where the push/pull handle sits on awkward faces, projected curves in a sketch, and Duplicate in the body list."""

import math

import pytest
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
from OCP.BRepClass import BRepClass_FaceClassifier
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.BRepGProp import BRepGProp
from OCP.Bnd import Bnd_Box
from OCP.GProp import GProp_GProps
from OCP.TopAbs import TopAbs_IN
from OCP.gp import gp_Pnt

from pliable import sketch
from pliable.ops import face_handle_point, planar_normal
from pliable.protocol import decode_binary
from pliable.server import Session
from pliable.topology import Topology
from test_watch_modeling import block_face, volume


def centre_of_mass(face):
    props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(face, props)
    return props.CentreOfMass()



def test_the_handle_point_of_an_l_shaped_face_lies_on_the_face():
    from build123d import Box, Pos

    # An L: a 40 x 10 bar plus a 10 x 30 bar; the center of mass of its top is in the notch, off the face.
    solid = (Box(40, 10, 5) + Pos(-15, 15, 0) * Box(10, 30, 5)).wrapped
    topology = Topology(solid)
    face = topology.face(block_face(topology, 0, 0, 1))
    centre = centre_of_mass(face)
    assert BRepClass_FaceClassifier(face, centre, 1e-6).State() != TopAbs_IN  # the plain center would hang in the air
    point = face_handle_point(face)
    assert math.dist((point.X(), point.Y(), point.Z()), (centre.X(), centre.Y(), centre.Z())) > 1.0
    assert BRepExtrema_DistShapeShape(face, BRepBuilderAPI_MakeVertex(point).Vertex()).Value() < 1e-6


def test_the_handle_point_of_a_ring_shaped_face_lies_on_the_face():
    from build123d import Box, Pos

    ring = (Box(40, 40, 5) - Pos(0, 0, 0) * Box(20, 20, 20)).wrapped
    topology = Topology(ring)
    face = topology.face(block_face(topology, 0, 0, 1))
    assert BRepClass_FaceClassifier(face, centre_of_mass(face), 1e-6).State() != TopAbs_IN
    session = Session()
    session.document = __import__("pliable.document", fromlist=["x"]).Document(ring, "ring")
    top = block_face(session.document.current, 0, 0, 1)
    (handle,) = session.handle({"type": "tool_handles", "tool": "push_pull", "selection": {"faces": [top]}, "params": {}})["handles"]
    assert BRepExtrema_DistShapeShape(face, BRepBuilderAPI_MakeVertex(gp_Pnt(*handle["anchor"])).Vertex()).Value() < 1e-6


def spline_projection(edge):
    return sketch.face_reference(edge.wrapped, sketch.STANDARD_PLANES["XY"], project=True)


def test_a_curved_edge_becomes_a_spline_through_33_points_on_its_projection():
    from build123d import Edge

    helix = Edge.make_spline([(0, 0, 0), (10, 5, 3), (20, -5, 6), (30, 0, 9)])
    ref = spline_projection(helix)
    splines = [e for e in ref["entities"] if e["type"] == "spline"]
    assert len(splines) == 1 and ref["drawn"]["splines"] == 1
    points = {p["id"]: p for p in ref["points"]}
    ids = splines[0]["points"]
    assert len(ids) == 33
    dense = [helix.position_at(k / 4000) for k in range(4001)]
    for i in ids:  # every sample lies on the flattened curve
        assert min(math.hypot(points[i]["u"] - d.X, points[i]["v"] - d.Y) for d in dense) < 0.02
    assert (points[ids[0]]["u"], points[ids[0]]["v"]) == pytest.approx((0, 0), abs=1e-6)
    assert (points[ids[-1]]["u"], points[ids[-1]]["v"]) == pytest.approx((30, 0), abs=1e-6)


def test_a_curve_seen_edge_on_is_left_as_its_end_points():
    from build123d import Edge

    flat = Edge.make_spline([(0, 0, 0), (10, 0, 5), (20, 0, -5), (30, 0, 0)])  # in the XZ plane, projected onto XY it is a line
    ref = spline_projection(flat)
    assert not any(e["type"] == "spline" for e in ref["entities"]) and ref["skipped"]["other"] == 1
    ends = {(round(p["u"], 6), round(p["v"], 6)) for p in ref["points"]}
    assert {(0.0, 0.0), (30.0, 0.0)} <= ends


def test_a_tilted_arc_is_an_elliptical_arc_not_a_spline():
    from build123d import Axis, Edge

    arc = Edge.make_circle(5, start_angle=0, end_angle=270).rotate(Axis.X, 30)
    ref = spline_projection(arc)
    assert ref["drawn"]["ellipse_arcs"] == 1 and ref["drawn"]["splines"] == 0


def test_duplicate_puts_a_plain_copy_exactly_on_the_original_and_undoes():
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    made = decode_binary(session.handle({"type": "tool_commit", "tool": "add_box", "selection": {}, "params": {"width": 10, "depth": 10, "height": 10, "x": 100, "new_body": 1}}))[0]
    original = next(b for b in made["bodies"] if b["id"] == 2)
    assert original["editable"]
    before = volume(session.document.current.shape)
    header = decode_binary(session.handle({"type": "duplicate_body", "body": 2}))[0]
    twin = next(b for b in header["bodies"] if b["id"] == header["created"])
    assert twin["id"] not in (1, 2) and twin["name"] == f"{original['name']} copy"
    assert not twin["editable"] and original["editable"] is True
    shape = session.document.current.shape
    from OCP.TopoDS import TopoDS

    from pliable.ops import solids_of

    solids = solids_of(shape)
    assert len(solids) == 3 and volume(shape) == pytest.approx(before + 1000)
    boxes = []
    for solid in solids[1:]:
        box = Bnd_Box()
        BRepBndLib.Add_s(solid, box)
        boxes.append([box.CornerMin().X(), box.CornerMin().Y(), box.CornerMin().Z(), box.CornerMax().X(), box.CornerMax().Y(), box.CornerMax().Z()])
    assert boxes[0] == pytest.approx(boxes[1])
    undone = decode_binary(session.handle({"type": "undo"}))[0]
    assert [b["id"] for b in undone["bodies"]] == [1, 2] and volume(session.document.current.shape) == pytest.approx(before)
