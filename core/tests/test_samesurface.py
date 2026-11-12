"""Faces that lie on one surface end up as one face, however the kernel described them (samesurface.py)."""

import math

import pytest
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakePolygon, BRepBuilderAPI_Transform
from OCP.BRepGProp import BRepGProp
from OCP.BRepPrimAPI import (
    BRepPrimAPI_MakeBox,
    BRepPrimAPI_MakeCone,
    BRepPrimAPI_MakeCylinder,
    BRepPrimAPI_MakePrism,
    BRepPrimAPI_MakeSphere,
    BRepPrimAPI_MakeTorus,
)
from OCP.GeomAbs import GeomAbs_Cone, GeomAbs_Cylinder, GeomAbs_Plane, GeomAbs_Sphere, GeomAbs_Torus
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec
from OCP.GProp import GProp_GProps
from OCP.TopoDS import TopoDS

import pliable.ops as ops
from pliable.demos import load_demo
from pliable.ops import OpResult, push_pull, unify_result
from pliable.samesurface import merge_same_surface
from pliable.topology import Topology
from pliable.validity import is_valid

Z, Y, X = gp_Dir(0, 0, 1), gp_Dir(0, 1, 0), gp_Dir(1, 0, 0)


def measures(shape):
    volume, area = GProp_GProps(), GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, volume)
    BRepGProp.SurfaceProperties_s(shape, area)
    return volume.Mass(), area.Mass()


def faces_of(shape, kind, radius=None):
    found = []
    for _, face in Topology(shape).faces():
        surface = BRepAdaptor_Surface(face)
        if surface.GetType() != kind:
            continue
        if radius is not None and abs(surface.Cylinder().Radius() - radius) > 1e-6:
            continue
        found.append(face)
    return found


def stacked(lower_tool, upper_tool):
    """Two slabs, one on the other, each cut by its own tool, and fused: a hollow that runs through both."""
    lower = BRepPrimAPI_MakeBox(gp_Pnt(-10, -10, 0), gp_Pnt(10, 10, 4)).Shape()
    upper = BRepPrimAPI_MakeBox(gp_Pnt(-10, -10, 4), gp_Pnt(10, 10, 8)).Shape()
    lower = BRepAlgoAPI_Cut(lower, lower_tool).Shape()
    upper = BRepAlgoAPI_Cut(upper, upper_tool).Shape()
    return BRepAlgoAPI_Fuse(lower, upper).Shape()


def unified(shape, tracked=()):
    return unify_result(OpResult(shape, list(tracked)))


def test_a_bore_from_the_other_end_is_one_face():
    # The bore of one part starts at the far side of the other, so the seam of the two halves sits at different places.
    post = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, 0), Z), 43, 24).Shape()
    block = BRepAlgoAPI_Cut(BRepPrimAPI_MakeBox(gp_Pnt(-60, -15, 0), gp_Pnt(60, 15, 24)).Shape(), post).Shape()

    def bored(part, direction):
        start = gp_Pnt(-70, 0, 12) if direction > 0 else gp_Pnt(70, 0, 12)
        return BRepAlgoAPI_Cut(part, BRepPrimAPI_MakeCylinder(gp_Ax2(start, gp_Dir(direction, 0, 0)), 5, 140).Shape()).Shape()

    both = BRepAlgoAPI_Fuse(bored(post, 1), bored(block, -1)).Shape()
    assert len(faces_of(both, GeomAbs_Cylinder, 5)) == 3
    walls = faces_of(both, GeomAbs_Cylinder, 5)
    result = unified(both, walls)
    assert len(faces_of(result.shape, GeomAbs_Cylinder, 5)) == 1
    assert is_valid(result.shape)
    assert measures(result.shape) == pytest.approx(measures(both), rel=1e-6)  # the fused shape's own integrals are approximate to that degree
    # the tracked walls are followed to the one wall, found in the new shape by its id
    topology = Topology(result.shape)
    assert result.tracked_faces and all(topology.face_id(f) is not None for f in result.tracked_faces)
    assert all(BRepAdaptor_Surface(TopoDS.Face(f)).GetType() == GeomAbs_Cylinder for f in result.tracked_faces)


def test_a_countersink_cone_with_another_seam_is_one_face():
    both = stacked(
        BRepPrimAPI_MakeCone(gp_Ax2(gp_Pnt(0, 0, 0), Z), 3, 5, 4).Shape(),
        BRepPrimAPI_MakeCone(gp_Ax2(gp_Pnt(0, 0, 4), Z, Y), 5, 7, 4).Shape(),  # the angle starts a quarter turn later
    )
    assert len(faces_of(both, GeomAbs_Cone)) == 2
    result = unified(both, faces_of(both, GeomAbs_Cone))
    assert len(faces_of(result.shape, GeomAbs_Cone)) == 1
    assert is_valid(result.shape)
    assert measures(result.shape) == pytest.approx(measures(both), rel=1e-9)
    assert len(result.tracked_faces) >= 1
    assert all(Topology(result.shape).face_id(f) is not None for f in result.tracked_faces)


def test_the_halves_of_a_spherical_cavity_are_one_face():
    both = stacked(BRepPrimAPI_MakeSphere(gp_Ax2(gp_Pnt(0, 0, 4), Z), 3).Shape(), BRepPrimAPI_MakeSphere(gp_Ax2(gp_Pnt(0, 0, 4), Z, Y), 3).Shape())
    assert len(faces_of(both, GeomAbs_Sphere)) == 2
    result = unified(both)
    assert len(faces_of(result.shape, GeomAbs_Sphere)) == 1
    assert is_valid(result.shape)
    assert measures(result.shape) == pytest.approx(measures(both), rel=1e-9)


def test_the_halves_of_a_torus_are_one_face():
    def half(direction):
        return BRepPrimAPI_MakeTorus(gp_Ax2(gp_Pnt(0, 0, 0), Z, direction), 5, 2, math.pi).Shape()

    both = BRepAlgoAPI_Fuse(half(X), half(gp_Dir(-1, 0, 0))).Shape()
    assert len(faces_of(both, GeomAbs_Torus)) == 2
    merged = merge_same_surface(both)
    assert merged is not None
    assert len(faces_of(merged.shape, GeomAbs_Torus)) == 1
    assert is_valid(merged.shape)
    assert measures(merged.shape) == pytest.approx(measures(both), rel=1e-9)


def test_coaxial_cylinders_of_different_radius_stay_separate():
    both = stacked(
        BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, 0), Z), 3, 4).Shape(),
        BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, 4), Z), 3.5, 4).Shape(),
    )
    merged = merge_same_surface(both)  # the slabs' side planes do join
    assert len(faces_of(merged.shape, GeomAbs_Cylinder)) == 2
    assert len(faces_of(unified(both).shape, GeomAbs_Cylinder)) == 2


def test_planes_at_a_small_angle_stay_separate():
    outline = BRepBuilderAPI_MakePolygon()
    for x, z in ((0, 0), (20, 0), (20, 4.01), (10, 4), (0, 4)):  # the top bends by 1e-3 radians at x = 10
        outline.Add(gp_Pnt(x, 0, z))
    outline.Close()
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace

    wedge = BRepPrimAPI_MakePrism(BRepBuilderAPI_MakeFace(outline.Wire()).Face(), gp_Vec(0, 10, 0)).Shape()
    before = Topology(wedge).face_count
    assert merge_same_surface(wedge) is None
    assert Topology(unified(wedge).shape).face_count == before


def test_a_pulled_face_keeps_its_merged_wall_through_the_tool():
    # push_pull is the real tool path: it ends in unify_result, and the merged walls are ordinary walls for the next pull.
    plate = load_demo("perforated_plate")
    top = max(
        (f for _, f in Topology(plate).faces() if ops.planar_normal(f) is not None),
        key=lambda f: ops.planar_normal(f).Z() * 1e6 + BRepAdaptor_Surface(f).Plane().Location().Z(),
    )
    result = push_pull(plate, top, 2.0)
    assert is_valid(result.shape)
    assert len(result.tracked_faces) == 1
    assert Topology(result.shape).face_id(result.tracked_faces[0]) is not None
    again = push_pull(result.shape, TopoDS.Face(result.tracked_faces[0]), 1.0)
    assert is_valid(again.shape)
    assert Topology(again.shape).face_count == Topology(result.shape).face_count
