"""Cylinder walls that continue each other end up as one face, however the kernel described them."""

import pytest
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy
from OCP.BRepGProp import BRepGProp
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt
from OCP.GProp import GProp_GProps
from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain
from OCP.TopoDS import TopoDS

from pliable import meshing
from pliable.demos import load_demo
from pliable.ops import OpResult, planar_normal, push_pull, unify_result
from pliable.topology import Topology
from pliable.validity import is_valid
from pliable.wallframes import align_walls


def measures(shape):
    volume, area = GProp_GProps(), GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, volume)
    BRepGProp.SurfaceProperties_s(shape, area)
    return volume.Mass(), area.Mass()


def top_face(shape):
    topology = Topology(shape)
    return topology.face(max((n.Z(), i) for i, f in topology.faces() if (n := planar_normal(f)) is not None)[1])


def slab(z0, z1, axis_up, centres):
    """A plate from z0 to z1 with a hole at each center; the hole's cylinder has its axis up or down."""
    box = BRepPrimAPI_MakeBox(gp_Pnt(0, 0, z0), gp_Pnt(20 * len(centres), 20, z1)).Shape()
    for x in centres:
        axis = gp_Ax2(gp_Pnt(x, 10, z0), gp_Dir(0, 0, 1)) if axis_up else gp_Ax2(gp_Pnt(x, 10, z1), gp_Dir(0, 0, -1))
        box = BRepAlgoAPI_Cut(box, BRepPrimAPI_MakeCylinder(axis, 3, z1 - z0).Shape()).Shape()
    return box


def merged(shape):
    unify = ShapeUpgrade_UnifySameDomain(BRepBuilderAPI_Copy(shape, False, True).Shape(), True, True, True)
    unify.Build()
    return unify.Shape()


def test_pulling_a_face_with_holes_keeps_each_hole_wall_one_face():
    plate = load_demo("perforated_plate")
    before = Topology(plate).face_count
    top = top_face(plate)
    assert meshing._holes(top) >= meshing.MANY_HOLES
    area = measures(top)[1]
    result = push_pull(plate, top, 2.0)
    assert Topology(result.shape).face_count == before
    assert is_valid(result.shape)
    assert measures(result.shape)[0] == pytest.approx(measures(plate)[0] + 2.0 * area, rel=1e-9)
    assert len(result.tracked_faces) == 1 and planar_normal(TopoDS.Face(result.tracked_faces[0])).Z() == pytest.approx(1.0)
    again = push_pull(result.shape, TopoDS.Face(result.tracked_faces[0]), 1.5)  # the merged walls are ordinary walls for the next pull
    assert Topology(again.shape).face_count == before
    assert is_valid(again.shape)
    assert is_valid(plate) and Topology(plate).face_count == before  # the source is left as it was


def test_walls_with_opposite_axes_are_described_alike_and_then_merge():
    centres = [10, 30]
    both = BRepAlgoAPI_Fuse(slab(0, 4, True, centres), slab(4, 6, False, centres)).Shape()
    whole = 6 + len(centres)
    assert Topology(merged(both)).face_count > whole  # the kernel's merge alone leaves the walls split
    aligned, pairs = align_walls(BRepBuilderAPI_Copy(both, False, True).Shape())
    assert len(pairs) == len(centres)
    assert is_valid(aligned)
    assert measures(aligned) == pytest.approx(measures(both), rel=1e-12)
    out = merged(aligned)
    assert Topology(out).face_count == whole
    assert is_valid(out)
    assert measures(out) == pytest.approx(measures(both), rel=1e-9)


def test_walls_that_already_agree_are_left_alone():
    both = BRepAlgoAPI_Fuse(slab(0, 4, True, [10]), slab(4, 6, True, [10])).Shape()
    assert align_walls(BRepBuilderAPI_Copy(both, False, True).Shape()) is None
    assert align_walls(BRepBuilderAPI_Copy(load_demo("bracket"), False, True).Shape()) is None


def test_a_tracked_wall_is_followed_through_the_merge():
    both = BRepAlgoAPI_Fuse(slab(0, 4, True, [10]), slab(4, 6, False, [10])).Shape()
    walls = [f for _, f in Topology(both).faces() if planar_normal(f) is None]
    assert len(walls) == 2
    result = unify_result(OpResult(both, walls))
    assert Topology(result.shape).face_count == 7
    assert result.tracked_faces and all(Topology(result.shape).face_id(f) is not None for f in result.tracked_faces)
    assert all(planar_normal(TopoDS.Face(f)) is None for f in result.tracked_faces)
