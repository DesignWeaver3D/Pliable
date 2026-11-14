import math

import pytest
from build123d import Box, Cone, Cylinder, fillet
from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.GeomAbs import GeomAbs_Cone, GeomAbs_Cylinder, GeomAbs_Plane, GeomAbs_Sphere, GeomAbs_Torus

from pliable.ops import OperationError
from pliable.tools import Selection, get_tool
from pliable.topology import Topology
from test_features import volume
from test_stretch import face_with_normal

PLANE_OR_CYL = {GeomAbs_Plane, GeomAbs_Cylinder}


def stretch(topology, faces=(), edges=(), vertices=(), preview=False, **params):
    sel = Selection(faces=list(faces), edges=list(edges), vertices=list(vertices))
    return get_tool("stretch").execute(topology, sel, params, preview=preview)


def bar():
    return Topology((Box(100, 20, 10) - Cylinder(4, 20)).wrapped)


def surface_types(shape):
    topology = Topology(shape)
    return [BRepAdaptor_Surface(f).GetType() for _, f in topology.faces()]


def cylinders(shape, radius=None):
    topology = Topology(shape)
    found = []
    for _, f in topology.faces():
        s = BRepAdaptor_Surface(f)
        if s.GetType() == GeomAbs_Cylinder and (radius is None or abs(s.Cylinder().Radius() - radius) < 1e-6):
            found.append(s.Cylinder())
    return found


def hole_x(shape):
    cyls = cylinders(shape, 4)
    assert len(cyls) == 1
    assert cyls[0].Radius() == pytest.approx(4, abs=1e-6)
    return cyls[0].Axis().Location().X()


def x_extent(shape):
    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib

    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, box, False, False)
    return box.CornerMin().X(), box.CornerMax().X()


def valid(shape):
    return BRepCheck_Analyzer(shape).IsValid()


def end_face(topology):
    return face_with_normal(topology, [1.0, 0.0, 0.0])


def test_bar_end_stretch_keeps_hole():
    t = bar()
    v0 = volume(t.shape)
    r = stretch(t, [end_face(t)], dx=30)
    assert valid(r.shape)
    # exact volume gain and unchanged topology count
    assert volume(r.shape) == pytest.approx(v0 + 20 * 10 * 30, rel=1e-6)
    assert Topology(r.shape).face_count == t.face_count
    # only planes and cylinders remain
    assert set(surface_types(r.shape)) <= PLANE_OR_CYL
    # the hole is unmoved and round
    assert hole_x(r.shape) == pytest.approx(0, abs=1e-6)
    # far end fixed, moved end at 80
    lo, hi = x_extent(r.shape)
    assert lo == pytest.approx(-50, abs=1e-5)
    assert hi == pytest.approx(80, abs=1e-5)
    assert r.notice is None


def test_bar_wide_band_moves_hole_share():
    t = bar()
    v0 = volume(t.shape)
    r = stretch(t, [end_face(t)], dx=30, band=90)
    assert valid(r.shape)
    # same exact volume gain
    assert volume(r.shape) == pytest.approx(v0 + 20 * 10 * 30, rel=1e-6)
    # hole stays round and has moved by a share of the move
    assert 0 < hole_x(r.shape) < 30


def test_box_style_selection_matches_face_only():
    t = bar()
    v0 = volume(t.shape)
    f = end_face(t)
    face = t.face(f)
    edges = [i for i, e in t.edges() if any(t.face_id(x) == f for x in t.edge_faces(e))]
    verts = []
    for i, v in t.vertices():
        if BRep_Tool.Pnt_s(v).X() > 49.9:
            verts.append(i)
    assert len(edges) == 4 and len(verts) == 4
    r = stretch(t, [f], edges=edges, vertices=verts, dx=30)
    assert valid(r.shape)
    assert volume(r.shape) == pytest.approx(v0 + 20 * 10 * 30, rel=1e-6)


def test_filleted_end():
    t = Topology(fillet(Box(60, 30, 20).edges(), 3).wrapped)
    v0 = volume(t.shape)
    r = stretch(t, [end_face(t)], dx=10)
    assert valid(r.shape)
    # section area of the rounded block times the move
    assert volume(r.shape) == pytest.approx(v0 + (30 * 20 - (4 - math.pi) * 9) * 10, rel=1e-6)
    assert Topology(r.shape).face_count == t.face_count
    assert set(surface_types(r.shape)) <= {GeomAbs_Plane, GeomAbs_Cylinder, GeomAbs_Sphere, GeomAbs_Torus}
    assert r.notice is None


def test_cylinder_along_axis():
    t = Topology(Cylinder(10, 40).wrapped)
    r = stretch(t, [face_with_normal(t, [0.0, 0.0, 1.0])], dz=10)
    assert valid(r.shape)
    assert volume(r.shape) == pytest.approx(math.pi * 100 * 50, rel=1e-6)
    # side stays a cylinder
    assert GeomAbs_Cylinder in surface_types(r.shape)


def test_cone_frustum():
    t = Topology(Cone(10, 5, 20).wrapped)
    r = stretch(t, [face_with_normal(t, [0.0, 0.0, 1.0])], dz=10)
    assert valid(r.shape)
    assert GeomAbs_Cone in surface_types(r.shape)
    assert volume(r.shape) == pytest.approx(math.pi * 30 / 3 * (100 + 25 + 50), rel=1e-6)


def test_tilt_of_an_end():
    t = Topology(Box(40, 30, 20).wrapped)
    r = stretch(t, [face_with_normal(t, [0.0, 0.0, 1.0])], dz=0, rx=10)
    assert valid(r.shape)
    assert volume(r.shape) > 0
    # side faces stay planes
    assert all(s == GeomAbs_Plane for s in surface_types(r.shape))
    b = bar()
    r2 = stretch(b, [end_face(b)], ry=15, continuity=0)
    assert valid(r2.shape)


def test_shortening_removes_hole():
    t = bar()
    r = stretch(t, [end_face(t)], dx=-60)
    assert valid(r.shape)
    assert volume(r.shape) == pytest.approx(40 * 20 * 10, rel=1e-6)
    assert Topology(r.shape).face_count == 6
    # the notice names the removed feature
    assert "Removed 1 feature" in (r.notice or "")


def test_shortening_within_band_keeps_hole():
    t = bar()
    v0 = volume(t.shape)
    r = stretch(t, [end_face(t)], dx=-20)
    assert valid(r.shape)
    assert Topology(r.shape).face_count == t.face_count
    assert volume(r.shape) == pytest.approx(v0 - 20 * 10 * 20, rel=1e-6)


@pytest.mark.parametrize("continuity", [0, 1])
def test_free_form_slide(continuity):
    t = bar()
    r = stretch(t, [end_face(t)], dz=5, continuity=continuity)
    assert valid(r.shape)
    # sliding sideways preserves volume
    assert volume(r.shape) == pytest.approx(volume(t.shape), rel=1e-5)
    assert "free-form" in (r.notice or "")
    # hole untouched
    assert hole_x(r.shape) == pytest.approx(0, abs=1e-6)


def test_face_ids_carried():
    for params in ({"dx": 30}, {"dz": 5, "continuity": 1}):
        t = bar()
        f = end_face(t)
        r = stretch(t, [f], **params)
        out = Topology(r.shape)
        assert out.face_id(r.tracked_faces[0]) == f
        assert out.face_count == t.face_count


def test_fold_refusal_or_valid():
    t = bar()
    try:
        r = stretch(t, [end_face(t)], dz=40, band=3)
    except OperationError as e:
        assert "fold" in str(e).lower()
    else:
        assert valid(r.shape)


def test_preview_matches():
    t = bar()
    v0 = volume(t.shape)
    r = stretch(t, [end_face(t)], dx=30, preview=True)
    assert volume(r.shape) == pytest.approx(v0 + 20 * 10 * 30, rel=1e-6)
