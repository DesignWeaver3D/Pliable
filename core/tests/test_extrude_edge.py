"""Extrude edge: model edges swept along a direction into a surface body."""

import math

import pytest
from build123d import Box, Cylinder
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.GeomAbs import GeomAbs_Circle
from OCP.TopAbs import TopAbs_FACE
from OCP.TopExp import TopExp_Explorer

from pliable.ops import OperationError, is_surface, solids_of
from pliable.tools import Selection, get_tool
from pliable.topology import Topology


def _run(shape, edges, **params):
    return get_tool("extrude_edge").execute(Topology(shape), Selection(edges=list(edges)), params, preview=False)


def _area(body):
    props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(body, props)
    return props.Mass()


def _faces(body):
    n, e = 0, TopExp_Explorer(body, TopAbs_FACE)
    while e.More():
        n, _ = n + 1, e.Next()
    return n


def _edge_where(topology, test):
    return next(i for i in range(topology.edge_count) if test(BRepAdaptor_Curve(topology.edge(i))))


def test_a_straight_edge_becomes_a_rectangle_surface():
    box = Box(10, 20, 30).wrapped
    topology = Topology(box)
    edge = _edge_where(topology, lambda c: abs(c.Value(c.FirstParameter()).Distance(c.Value(c.LastParameter())) - 20) < 1e-6)
    result = _run(box, [edge], distance=5, dx=0, dy=0, dz=1)
    bodies = solids_of(result.shape)
    assert [is_surface(b) for b in bodies] == [False, True]
    assert _area(bodies[1]) == pytest.approx(20 * 5)
    assert _faces(bodies[1]) == 1


def test_an_arc_edge_becomes_a_curved_surface():
    cylinder = Cylinder(5, 10).wrapped
    topology = Topology(cylinder)
    edge = _edge_where(topology, lambda c: c.GetType() == GeomAbs_Circle)
    result = _run(cylinder, [edge], distance=4, dx=0, dy=0, dz=-1)
    surface = solids_of(result.shape)[1]
    assert is_surface(surface)
    assert _area(surface) == pytest.approx(2 * math.pi * 5 * 4, rel=1e-6)


def test_two_connected_edges_make_one_surface_body():
    box = Box(10, 20, 30).wrapped
    topology = Topology(box)
    top = [i for i in range(topology.edge_count) if all(abs(BRepAdaptor_Curve(topology.edge(i)).Value(t).Z() - 15) < 1e-6 for t in (0, 0.5))]
    ends = lambda i: {tuple(round(x, 6) for x in (p.X(), p.Y(), p.Z())) for p in (BRepAdaptor_Curve(topology.edge(i)).Value(BRepAdaptor_Curve(topology.edge(i)).FirstParameter()), BRepAdaptor_Curve(topology.edge(i)).Value(BRepAdaptor_Curve(topology.edge(i)).LastParameter()))}
    first = top[0]
    second = next(i for i in top if i != first and ends(i) & ends(first))
    result = _run(box, [first, second], distance=3, dx=0, dy=0, dz=1)
    bodies = solids_of(result.shape)
    assert len(bodies) == 2 and is_surface(bodies[1])
    assert _faces(bodies[1]) == 2
    assert _area(bodies[1]) == pytest.approx((10 + 20) * 3)


def test_a_direction_along_a_straight_edge_is_refused():
    box = Box(10, 20, 30).wrapped
    topology = Topology(box)
    edge = _edge_where(topology, lambda c: abs(c.Value(c.FirstParameter()).Distance(c.Value(c.LastParameter())) - 30) < 1e-6)
    with pytest.raises(OperationError, match="along a straight edge"):
        _run(box, [edge], distance=5, dx=0, dy=0, dz=1)
