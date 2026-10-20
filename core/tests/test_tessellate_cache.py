"""The display cache must never change what a tessellation returns."""

import numpy as np
from build123d import Box, Compound, Cylinder, Pos

from pliable import tessellate as tess
from pliable.document import Document
from pliable.ops import fillet_chamfer, planar_normal
from pliable.server import Session
from pliable.tessellate import display_cache, tessellate
from pliable.topology import Topology


def blocks(n):
    return Compound([Pos(i * 30, 0, 0) * (Box(20, 20, 10) - Cylinder(3, 20)) for i in range(n)]).wrapped


def same(a, b):
    for name in ("positions", "normals", "indices", "edge_positions"):
        x, y = getattr(a, name), getattr(b, name)
        assert x.dtype == y.dtype and x.shape == y.shape and x.tobytes() == y.tobytes(), name
    for name in ("faces", "edges", "vertices", "centres", "bodies", "bounds"):
        assert getattr(a, name) == getattr(b, name), name


def fresh(topology, preview=False):
    display_cache.clear()
    return tessellate(topology, preview)


def top_face(topology):
    return next(i for i, f in topology.faces() if (n := planar_normal(f)) is not None and n.Z() > 0.999)


def test_cached_mesh_is_identical_to_a_fresh_one():
    topology = Topology(blocks(4))
    for preview in (False, True):
        expected = fresh(topology, preview)
        again = tessellate(topology, preview)  # all hits
        assert display_cache.hits > 0
        same(expected, again)


def test_commit_through_session_matches_uncached(monkeypatch):
    session = Session()
    session.document = Document(blocks(6), "t")
    face = top_face(session.document.current)
    session.handle({"type": "tool_commit", "tool": "push_pull", "selection": {"faces": [face]}, "params": {"distance": 3.0}})
    hits = display_cache.hits
    reply = session.handle({"type": "tool_commit", "tool": "push_pull", "selection": {"faces": [top_face(session.document.current)]}, "params": {"distance": -1.0}})
    assert isinstance(reply, bytes)
    assert display_cache.hits - hits > 30  # untouched bodies come from the cache
    current = session.document.current
    cached = tessellate(current)
    same(fresh(current), cached)


def test_moved_body_hits_with_new_location_and_matches():
    session = Session()
    session.document = Document(blocks(3), "t")
    tessellate(session.document.current)
    body = session.document.current.bodies.bodies[1].id
    session.handle({"type": "tool_commit", "tool": "move_body", "selection": {"bodies": [body]}, "params": {"dx": 7, "rz": 90}})
    current = session.document.current
    cached = tessellate(current)
    same(fresh(current), cached)
    positions = cached.bodies[1]["bounds"]
    assert positions[0] > 20  # the moved body really is elsewhere in the cached mesh


def test_filleted_edges_match():
    box = Box(10, 10, 10).wrapped
    topology = Topology(box)
    edges = [topology.edge(0), topology.edge(1)]
    shape = fillet_chamfer(box, edges, 1.0).shape
    topology = Topology(shape)
    expected = fresh(topology)
    same(expected, tessellate(topology))


def test_changed_deflection_is_a_miss():
    topology = Topology(blocks(1))
    fresh(topology)
    misses = display_cache.misses
    far = Compound([Pos(0, 0, 0) * (Box(20, 20, 10) - Cylinder(3, 20)), Pos(5000, 0, 0) * Box(1, 1, 1)]).wrapped  # larger model, coarser deflection
    tessellate(Topology(far))
    assert display_cache.misses > misses
    same(fresh(Topology(far)), tessellate(Topology(far)))


def test_cache_is_bounded(monkeypatch):
    monkeypatch.setattr(tess, "CACHE_LIMIT", 200)
    display_cache.clear()
    tessellate(Topology(blocks(20)))
    assert display_cache.weight <= 200 + 100
    assert np.array_equal(tessellate(Topology(blocks(2))).bounds, fresh(Topology(blocks(2))).bounds)
