"""Editing displayed dimensions in place goes through Session.handle and the ordinary tools (one undo step each)."""

import pytest
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepGProp import BRepGProp
from OCP.GeomAbs import GeomAbs_Cylinder, GeomAbs_Line
from OCP.GProp import GProp_GProps

from pliable.dimedit import draft_angle
from pliable.measure import hole_centre
from pliable.ops import OperationError, planar_normal
from pliable.protocol import decode_binary
from pliable.server import RequestError, Session


def session_with(demo):
    s = Session()
    s.handle({"type": "open_demo", "name": demo})
    return s


def top(s):
    return s.document.current


def measure(s, **sel):
    return s.handle({"type": "measure", "selection": sel})


def edit(s, kind, value, commit=True, flip=False, **sel):
    reply = s.handle({"type": "dimension_edit", "selection": sel, "dimension": kind, "value": value, "commit": commit, "flip": flip})
    return decode_binary(reply)[0]


def volume(s):
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(top(s).shape, props)
    return props.Mass()


def cylinders(t, radius):
    return [i for i, f in t.faces() if BRepAdaptor_Surface(f).GetType() == GeomAbs_Cylinder and abs(BRepAdaptor_Surface(f).Cylinder().Radius() - radius) < 1e-6]


def x_planes(t):
    return sorted(round(BRepAdaptor_Surface(f).Plane().Location().X(), 6) for _, f in t.faces() if planar_normal(f) is not None and abs(planar_normal(f).X()) > 0.5)


def face_where(t, normal, plane_at):
    """The flat face whose outward normal is `normal` and whose plane lies `plane_at` along that normal."""
    for i, f in t.faces():
        n = planar_normal(f)
        if n is not None and abs(n.X() - normal[0]) + abs(n.Y() - normal[1]) + abs(n.Z() - normal[2]) < 1e-6:
            loc = BRepAdaptor_Surface(f).Plane().Location()
            if abs(loc.X() * normal[0] + loc.Y() * normal[1] + loc.Z() * normal[2] - plane_at) < 1e-6:
                return i
    raise AssertionError("face not found")


def line_edge(t, length):
    return next(i for i, e in t.edges() if BRepAdaptor_Curve(e).GetType() == GeomAbs_Line and abs(BRepAdaptor_Curve(e).LastParameter() - BRepAdaptor_Curve(e).FirstParameter() - length) < 1e-6)


def test_hole_diameter_from_wall_and_rim_with_undo():
    s = session_with("bracket")
    t = top(s)
    wall = cylinders(t, 4)[0]
    d = measure(s, faces=[wall])["dimensions"][0]
    assert d["edit"]["kind"] == "hole_diameter" and d["edit"]["value"] == pytest.approx(8)
    edit(s, "hole_diameter", 10, faces=[wall])
    assert len(cylinders(top(s), 5)) == 1
    s.handle({"type": "undo"})
    assert len(cylinders(top(s), 4)) == 4 and not cylinders(top(s), 5)
    rim = next(i for i, e in t.edges() if BRepAdaptor_Curve(e).GetType() != GeomAbs_Line and abs(BRepAdaptor_Curve(e).Circle().Radius() - 4) < 1e-6)
    d = measure(s, edges=[rim])["dimensions"][0]
    assert d["edit"]["kind"] == "hole_diameter" and d["edit"]["value"] == pytest.approx(8)
    edit(s, "hole_diameter", 6, edges=[rim])
    assert len(cylinders(top(s), 3)) == 1


def test_preview_does_not_commit():
    s = session_with("bracket")
    wall = cylinders(top(s), 4)[0]
    header = edit(s, "hole_diameter", 10, commit=False, faces=[wall])
    assert header["preview"] is True
    assert len(cylinders(top(s), 4)) == 4  # the committed model is untouched by a preview


def test_fillet_radius():
    s = session_with("bracket")
    t = top(s)
    fillet = next(i for i, _ in t.faces() if measure(s, faces=[i])["items"][0]["title"] == "Fillet")
    d = measure(s, faces=[fillet])["dimensions"][0]
    assert d["edit"]["kind"] == "fillet_radius" and d["edit"]["value"] == pytest.approx(6)
    edit(s, "fillet_radius", 3, faces=[fillet])
    assert len(cylinders(top(s), 3)) == 1 and len(cylinders(top(s), 6)) == len(cylinders(t, 6)) - 1
    s.handle({"type": "undo"})
    assert len(cylinders(top(s), 6)) == len(cylinders(t, 6)) and not cylinders(top(s), 3)


def test_edge_length_moves_end_face():
    s = session_with("block")  # 40 x 30 x 20
    edge = line_edge(top(s), 40)
    d = measure(s, edges=[edge])["dimensions"][0]
    assert d["edit"]["kind"] == "edge_length" and d["edit"]["value"] == pytest.approx(40)
    v0 = volume(s)
    edit(s, "edge_length", 55, edges=[edge])
    assert volume(s) == pytest.approx(v0 * 55 / 40)
    s.handle({"type": "undo"})
    assert volume(s) == pytest.approx(v0)
    first = x_planes(top(s))
    edit(s, "edge_length", 25, edges=[edge])
    assert x_planes(top(s))[0] == first[0]  # the default end moves; the other stays
    s.handle({"type": "undo"})
    edit(s, "edge_length", 25, flip=True, edges=[edge])
    assert volume(s) == pytest.approx(v0 * 25 / 40)
    assert x_planes(top(s))[-1] == first[-1]


def test_edge_length_reason_and_no_change():
    s = session_with("bracket")
    t = top(s)
    blocked = None
    for i, e in t.edges():
        if BRepAdaptor_Curve(e).GetType() == GeomAbs_Line:
            d = measure(s, edges=[i])["dimensions"][0]
            if d["edit"].get("blocked"):
                blocked = (i, d["edit"]["blocked"])
                break
    assert blocked, "the bracket has edges that are not simple box corners"
    before = volume(s)
    with pytest.raises((RequestError, OperationError)):
        edit(s, "edge_length", 10, edges=[blocked[0]])
    assert volume(s) == pytest.approx(before)


def test_face_distance_flip_and_default_mover():
    s = session_with("block")
    t = top(s)
    left = face_where(t, (-1, 0, 0), 20)
    right = face_where(t, (1, 0, 0), 20)
    d = measure(s, faces=[left, right])["dimensions"][0]
    assert d["edit"]["kind"] == "face_distance" and d["edit"]["value"] == pytest.approx(40) and d["edit"]["canFlip"]
    edit(s, "face_distance", 50, faces=[left, right])  # the face clicked last (right) moves
    assert x_planes(top(s)) == [-20, 30]
    s.handle({"type": "undo"})
    edit(s, "face_distance", 50, flip=True, faces=[left, right])  # flipped: the left one moves
    assert x_planes(top(s)) == [-30, 20]


def test_face_distance_moving_face_inward_decreases():
    s = session_with("block")
    t = top(s)
    up = face_where(t, (0, 0, 1), 10)
    down = face_where(t, (0, 0, -1), 10)
    edit(s, "face_distance", 12, faces=[down, up])
    assert volume(s) == pytest.approx(40 * 30 * 12)


def test_face_distance_not_parallel_reason():
    s = session_with("block")
    t = top(s)
    a = face_where(t, (1, 0, 0), 20)
    b = face_where(t, (0, 1, 0), 15)
    d = measure(s, faces=[a, b])["dimensions"][0]
    assert "parallel" in d["edit"]["blocked"]
    with pytest.raises((RequestError, OperationError)):
        edit(s, "face_distance", 10, faces=[a, b])


def test_hole_distance_moves_last_hole_and_flips():
    s = session_with("bracket")
    t = top(s)
    a, b = cylinders(t, 4)[:2]
    ca, cb = hole_centre(t.face(a)), hole_centre(t.face(b))
    d0 = ca.Distance(cb)
    d = measure(s, faces=[a, b])["dimensions"][0]
    assert d["edit"]["kind"] == "hole_distance" and d["edit"]["value"] == pytest.approx(d0)

    def centres():
        return [hole_centre(top(s).face(i)) for i in cylinders(top(s), 4)]

    edit(s, "hole_distance", d0 + 5, faces=[a, b])
    assert any(c.Distance(ca) < 1e-6 for c in centres())  # the first hole stayed
    assert any(abs(c.Distance(ca) - (d0 + 5)) < 1e-4 for c in centres())
    s.handle({"type": "undo"})
    edit(s, "hole_distance", d0 + 5, flip=True, faces=[a, b])
    assert any(c.Distance(cb) < 1e-6 for c in centres())  # flipped: the second stayed


def test_non_editable_dimensions_say_why():
    s = session_with("block")
    face = face_where(top(s), (1, 0, 0), 20)
    for d in measure(s, faces=[face])["dimensions"]:
        if d["kind"] == "linear":
            assert "editNote" in d and "edit" not in d
    assert "editNote" in measure(s, vertices=[0])["dimensions"][0]


def test_draft_angle_edit():
    s = session_with("block")
    wall = face_where(top(s), (1, 0, 0), 20)
    angle_dim = next(d for d in measure(s, faces=[wall])["dimensions"] if d.get("edit", {}).get("kind") == "face_angle")
    assert angle_dim["edit"]["value"] == pytest.approx(0, abs=1e-9)
    centre = next(d for d in measure(s, faces=[wall])["items"])["anchor"]
    assert angle_dim["points"][0][2] > centre[2] + 1  # the tag sits above the face centre, off the push/pull arrow
    edit(s, "face_angle", 5, faces=[wall])
    tilted = [draft_angle(f) for _, f in top(s).faces() if planar_normal(f) is not None and abs(planar_normal(f).X()) > 0.9]
    assert any(abs(a - 5) < 1e-6 for a in tilted)
    s.handle({"type": "undo"})
    assert all(abs(draft_angle(f)) < 1e-9 for _, f in top(s).faces() if planar_normal(f) is not None and abs(planar_normal(f).X()) > 0.9)
