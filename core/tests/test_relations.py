from pliable.demos import load_demo
from pliable.relations import find_related
from pliable.server import Session
from pliable.topology import Topology
from test_features import faces_where


def rules(topology, face):
    return {r["id"]: r["faces"] for r in find_related(topology, face)}


def test_equal_radius_holes_and_coplanar_faces():
    bracket = Topology(load_demo("bracket"))
    holes = faces_where(bracket, "Cylinder", Radius=4)
    assert len(holes) == 4
    related = rules(bracket, holes[0])
    assert sorted(related["equal_radius"]) == sorted(h for h in holes if h != holes[0])
    # the base top has a coplanar sibling only if split; the upright top and base top are not coplanar
    planar = [i for i in range(bracket.face_count) if rules(bracket, i).get("coplanar")]
    assert planar  # the small corner patches are coplanar with the big base top
    wall = faces_where(bracket, "Cylinder", Radius=7)[0]
    assert "equal_radius" not in rules(bracket, wall)


def test_coaxial_and_server_request():
    from pliable.measure import measure
    from pliable.tools import Selection
    from test_features import run

    block = Topology(load_demo("block"))
    top = next(i for i in range(6) if measure(block, Selection(faces=[i]))["items"][0]["rows"][3]["value"] == [0.0, 0.0, 1.0])
    bored = Topology(run("add_counterbore", block, faces=[top], diameter=6, depth=0, bore_diameter=12, bore_depth=4).shape)
    thin = faces_where(bored, "Cylinder", Radius=3)[0]
    wide = faces_where(bored, "Cylinder", Radius=6)[0]
    assert rules(bored, thin)["coaxial"] == [wide]
    session = Session()
    session.handle({"type": "open_demo", "name": "bracket"})
    holes = faces_where(session.document.current, "Cylinder", Radius=4)
    reply = session.handle({"type": "related", "face": holes[0]})
    assert reply["rules"][0]["id"] == "equal_radius" and len(reply["rules"][0]["faces"]) == 3


def test_tangent_chain_follows_smooth_outlines_only():
    from pliable.measure import measure
    from pliable.relations import tangent_chain
    from pliable.tools import Selection

    bracket = Topology(load_demo("bracket"))
    rim = next(i for i in range(bracket.edge_count) if (lambda it: it["title"] == "Circle" and abs([r for r in it["rows"] if r["label"] == "Radius"][0]["value"] - 4) < 1e-6)(measure(bracket, Selection(edges=[i]))["items"][0]))
    assert tangent_chain(bracket, rim) == [rim]  # a full circle is closed on itself
    # the base outline: a straight edge continues into a corner arc, so the chain is longer than one edge
    line = next(i for i in range(bracket.edge_count) if measure(bracket, Selection(edges=[i]))["items"][0]["rows"][0]["value"] == 38.0 or abs(measure(bracket, Selection(edges=[i]))["items"][0]["rows"][0]["value"] - 68) < 1e-6)
    assert len(tangent_chain(bracket, line)) > 1
    block = Topology(load_demo("block"))
    assert tangent_chain(block, 0) == [0]  # box edges meet at right angles


def test_parallel_and_symmetric_faces():
    block = Topology(load_demo("block"))
    from pliable.measure import measure

    def normal(i):
        from pliable.measure import measure as m
        from pliable.tools import Selection
        return m(block, Selection(faces=[i]))["items"][0]["rows"][3]["value"]

    top = next(i for i in range(6) if normal(i) == [0.0, 0.0, 1.0])
    related = rules(block, top)
    assert "parallel" not in related  # the opposite face faces away, so it is not parallel in direction
    assert len(related["symmetric"]) == 1 and normal(related["symmetric"][0]) == [0.0, 0.0, -1.0]
    bracket = Topology(load_demo("bracket"))
    assert any(rules(bracket, i).get("parallel") for i in range(bracket.face_count))
    holes = faces_where(bracket, "Cylinder", Radius=4)
    assert any(rules(bracket, h).get("symmetric") for h in holes)


def test_cusps_and_reversed_edges_are_not_smooth_continuations():
    from build123d import Edge
    from OCP.gp import gp_Pnt
    from pliable.relations import _end_tangent, continues_smoothly

    origin = gp_Pnt(0, 0, 0)
    along_x = Edge.make_line((0, 0, 0), (10, 0, 0)).wrapped
    back_along_x = Edge.make_line((-10, 0, 0), (0, 0, 0)).wrapped  # ends at the origin, so it runs into it
    also_along_x = Edge.make_line((0, 0, 0), (5, 0, 0)).wrapped  # leaves the origin the same way as the first
    assert continues_smoothly(_end_tangent(back_along_x, origin), _end_tangent(along_x, origin))  # one straight line through the origin
    assert not continues_smoothly(_end_tangent(also_along_x, origin), _end_tangent(along_x, origin))  # a fold back on itself
