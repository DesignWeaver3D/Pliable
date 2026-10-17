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
