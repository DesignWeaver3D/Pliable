"""The one face merge step (facemerge.py): the same result from every tool's ending, and the edges-only fallback."""

from OCP.BRepAlgoAPI import BRepAlgoAPI_Fuse
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCP.gp import gp_Pnt

from pliable import facemerge
from pliable.ops import OpResult, planar_normal, unify_result
from pliable.shared.solids import finish
from pliable.topology import Topology
from pliable.validity import is_valid


def two_blocks():
    left = BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), gp_Pnt(10, 10, 10)).Shape()
    right = BRepPrimAPI_MakeBox(gp_Pnt(10, 0, 0), gp_Pnt(20, 10, 10)).Shape()
    return BRepAlgoAPI_Fuse(left, right).Shape()


def test_finish_and_unify_result_merge_alike():
    shape = two_blocks()
    a = finish(shape).shape
    b = unify_result(OpResult(shape, [])).shape
    assert Topology(a).face_count == Topology(b).face_count == 6
    assert is_valid(a) and is_valid(b)


def test_edges_only_merge_when_the_face_merge_breaks_the_shape(monkeypatch):
    shape = two_blocks()
    top = next(f for _, f in Topology(shape).faces() if planar_normal(f) is not None and planar_normal(f).Z() > 0.5)
    real = facemerge.is_valid
    calls = []

    def refuse_first(candidate):
        calls.append(1)
        return len(calls) > 1 and real(candidate)

    monkeypatch.setattr(facemerge, "is_valid", refuse_first)
    result = unify_result(OpResult(shape, [top]), align=False)
    assert is_valid(result.shape)
    assert result.unified and len(result.tracked_faces) == 1
    assert Topology(result.shape).face_id(result.tracked_faces[0]) is not None
    assert Topology(result.shape).face_count == 10  # faces unmerged, only edges joined
    assert finish(shape).cutters == []


def test_surfaces_one_axis_apart_by_the_merge_angle_are_one_surface_and_beyond_it_are_not():
    import math

    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeCylinder
    from OCP.GeomAbs import GeomAbs_Cylinder
    from OCP.gp import gp_Ax2, gp_Dir

    from pliable.mergelimits import MERGE_ANGLE
    from pliable.samesurface import same_surface

    def wall(tilt):
        shape = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(math.sin(tilt), 0, math.cos(tilt))), 5, 10).Shape()
        return next(BRepAdaptor_Surface(f) for _, f in Topology(shape).faces() if BRepAdaptor_Surface(f).GetType() == GeomAbs_Cylinder)

    assert same_surface(wall(0.0), wall(0.2 * MERGE_ANGLE))
    assert not same_surface(wall(0.0), wall(5 * MERGE_ANGLE))
