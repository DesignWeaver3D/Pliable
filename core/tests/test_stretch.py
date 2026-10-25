import time

import pytest
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakePolygon
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepOffsetAPI import BRepOffsetAPI_ThruSections
from OCP.gp import gp_Pnt

from pliable.demos import load_demo
from pliable.measure import measure
from pliable.ops import OperationError
from pliable.tools import Selection, get_tool
from pliable.topology import Topology
from test_features import volume


def run(topology, faces, **params):
    return get_tool("stretch").execute(topology, Selection(faces=list(faces)), params, preview=False)


def _normal(topology, i):
    rows = {r["label"]: r["value"] for r in measure(topology, Selection(faces=[i]))["items"][0]["rows"]}
    return rows.get("Normal")


def face_with_normal(topology, normal):
    return next(i for i in range(topology.face_count) if _normal(topology, i) == normal)


def rectangle(w, d, z):
    maker = BRepBuilderAPI_MakePolygon()
    for x, y in ((-w, -d), (w, -d), (w, d), (-w, d)):
        maker.Add(gp_Pnt(x, y, z))
    maker.Close()
    return maker.Wire()


def frustum():
    """100 tall, 60 x 60 at the bottom and 40 x 40 at the top (half sizes 30 and 20)."""
    loft = BRepOffsetAPI_ThruSections(True, True)
    loft.AddWire(rectangle(30, 30, 0))
    loft.AddWire(rectangle(20, 20, 100))
    loft.Build()
    return Topology(loft.Shape())


def test_stretch_extends_a_block():
    block = Topology(load_demo("block"))  # 40 x 30 x 20
    top = face_with_normal(block, [0.0, 0.0, 1.0])
    start = time.perf_counter()
    result = run(block, [top], dx=0, dy=0, dz=10, mode=0)
    assert time.perf_counter() - start < 2
    assert volume(result.shape) == pytest.approx(40 * 30 * 30, rel=1e-6)
    assert Topology(result.shape).face_count == 6
    assert BRepCheck_Analyzer(result.shape).IsValid()
    shorter = run(block, [top], dx=0, dy=0, dz=-5, mode=0)
    assert volume(shorter.shape) == pytest.approx(40 * 30 * 15, rel=1e-6)


def test_stretch_sideways_shears_the_sides():
    block = Topology(load_demo("block"))
    top = face_with_normal(block, [0.0, 0.0, 1.0])
    result = run(block, [top], dx=7, dy=0, dz=0, mode=0)  # the end slides, the sides lean
    assert volume(result.shape) == pytest.approx(24000, rel=1e-6)
    assert BRepCheck_Analyzer(result.shape).IsValid()


def test_stretch_a_taper_keeps_the_end_size():
    taper = frustum()
    bottom = face_with_normal(taper, [0.0, 0.0, -1.0])
    result = run(taper, [bottom], dx=0, dy=0, dz=-50, mode=0)  # bottom 60 wide stays 60 wide, slope eases
    grown = result.shape
    assert BRepCheck_Analyzer(grown).IsValid()
    # frustum of height 150, half-sizes 30 and 20: V = h/3 (A1 + A2 + sqrt(A1 A2)), A = (2s)^2
    expected = 150 / 3 * (3600 + 1600 + 60 * 40)
    assert volume(grown) == pytest.approx(expected, rel=1e-6)


def test_stretch_refuses_curved_neighbours_and_insert_still_works():
    plate = Topology(load_demo("perforated_plate"))
    side = face_with_normal(plate, [1.0, 0.0, 0.0])
    with pytest.raises(OperationError, match="Insert"):
        run(plate, [side], dx=5, dy=0, dz=0, mode=0)
    longer = run(plate, [side], dx=5, dy=0, dz=0, mode=1)
    assert volume(longer.shape) > volume(plate.shape)
    assert BRepCheck_Analyzer(longer.shape).IsValid()
