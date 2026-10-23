import math
import pytest

from pliable.demos import load_demo
from pliable.measure import measure
from pliable.ops import OperationError, fillet_chamfer
from pliable.tools import Selection
from pliable.topology import Topology


def value(item, label):
    return next(r["value"] for r in item["rows"] if r["label"] == label)


def find(topology, kind, **expected):
    """Ids of items whose measured title and row values match (values to 1e-6)."""
    ids = topology.face_count if kind == "face" else topology.edge_count
    found = []
    for i in range(ids):
        item = measure(topology, Selection(**{kind + "s": [i]}))["items"][0]
        title = expected.get("title")
        if title and item["title"] != title:
            continue
        if all(abs(value(item, k) - v) < 1e-6 for k, v in expected.items() if k != "title"):
            found.append(i)
    return found


@pytest.fixture
def block():
    return Topology(load_demo("block"))  # 40 x 30 x 20


@pytest.fixture
def bracket():
    return Topology(load_demo("bracket"))


def test_block_edge_lengths(block):
    lengths = sorted(value(measure(block, Selection(edges=[i]))["items"][0], "Length") for i in range(12))
    assert lengths == pytest.approx([20] * 4 + [30] * 4 + [40] * 4)


def test_block_face_area_and_size(block):
    (face,) = find(block, "face", Width=40, Height=30)[:1]
    item = measure(block, Selection(faces=[face]))["items"][0]
    assert item["title"] == "Plane"
    assert value(item, "Area") == pytest.approx(1200)


def test_bracket_hole_wall_and_rim(bracket):
    (wall,) = find(bracket, "face", title="Cylinder", Radius=7)
    item = measure(bracket, Selection(faces=[wall]))["items"][0]
    assert value(item, "Diameter") == pytest.approx(14)
    assert value(item, "Length") == pytest.approx(10)  # the upright's thickness
    (rim,) = find(bracket, "edge", title="Circle", Radius=7)[:1]
    assert value(measure(bracket, Selection(edges=[rim]))["items"][0], "Diameter") == pytest.approx(14)


def test_bracket_corner_fillet_is_labelled_with_radius(bracket):
    fillets = find(bracket, "face", title="Fillet", Radius=6)
    assert fillets
    item = measure(bracket, Selection(faces=[fillets[0]]))["items"][0]
    assert value(item, "Sweep") == pytest.approx(90)


def test_arc_edge_has_angle(bracket):
    arc = find(bracket, "edge", title="Arc", Radius=6)[0]
    assert value(measure(bracket, Selection(edges=[arc]))["items"][0], "Arc angle") == pytest.approx(90)


def test_vertex_coordinates(block):
    item = measure(block, Selection(vertices=[0]))["items"][0]
    assert sorted(abs(value(item, axis)) for axis in "XYZ") == pytest.approx([10, 15, 20])


def test_two_edges_sum_and_distance(block):
    edges = find(block, "edge", Length=40)[:1] + find(block, "edge", Length=30)[:1]
    result = measure(block, Selection(edges=edges))
    summary = {r["label"]: r["value"] for r in result["summary"]}
    assert summary["Selected"] == 2
    assert summary["Total length"] == pytest.approx(70)
    assert "Distance" in summary


def test_parallel_faces_distance_and_angle(block):
    top_bottom = [i for i in range(6) if abs(abs(value(measure(block, Selection(faces=[i]))["items"][0], "Normal")[2]) - 1) < 1e-9]
    result = measure(block, Selection(faces=top_bottom))
    summary = {r["label"]: r["value"] for r in result["summary"]}
    assert summary["Distance"] == pytest.approx(20)
    assert summary["Angle"] == pytest.approx(0)
    assert summary["Total area"] == pytest.approx(2400)


def test_mixed_kinds_rejected(block):
    with pytest.raises(OperationError):
        measure(block, Selection(faces=[0], edges=[0]))


def test_fillet_made_by_tool_measures_its_radius(block):
    result = fillet_chamfer(block.shape, [block.edge(0)], 3)
    after = Topology(result.shape)
    assert find(after, "face", title="Fillet", Radius=3)


def dims(result):
    return result["dimensions"]


def test_line_edge_dimension_is_offset_away_from_part(block):
    edge = find(block, "edge", Length=40)[0]
    (dim,) = dims(measure(block, Selection(edges=[edge])))
    assert dim["kind"] == "linear" and dim["text"] == "40"
    p, q = dim["points"]
    assert sum((a - b) ** 2 for a, b in zip(p, q)) == pytest.approx(1600)
    mid = [(a + b) / 2 for a, b in zip(p, q)]
    off = dim["offsetDirection"]
    assert sum(o * (m - 0) for o, m in zip(off, mid)) > 0  # block is centered on the origin
    assert sum(o * (a - b) for o, a, b in zip(off, p, q)) == pytest.approx(0)


def test_hole_wall_shows_diameter_and_depth(bracket):
    (wall,) = find(bracket, "face", title="Cylinder", Radius=7)
    texts = {d["kind"]: d["text"] for d in dims(measure(bracket, Selection(faces=[wall])))}
    assert texts == {"diameter": "⌀14", "linear": "10"}


def test_circle_rim_diameter_points_are_opposite(bracket):
    rim = find(bracket, "edge", title="Circle", Radius=7)[0]
    (dim,) = dims(measure(bracket, Selection(edges=[rim])))
    p, q = dim["points"]
    assert sum((a - b) ** 2 for a, b in zip(p, q)) == pytest.approx(14**2)


def test_arc_and_fillet_show_radius(bracket):
    arc = find(bracket, "edge", title="Arc", Radius=6)[0]
    (d1,) = dims(measure(bracket, Selection(edges=[arc])))
    fillet = find(bracket, "face", title="Fillet", Radius=6)[0]
    (d2,) = dims(measure(bracket, Selection(faces=[fillet])))
    for d in (d1, d2):
        assert d["kind"] == "radius" and d["text"] == "R6"
        p, q = d["points"]
        assert sum((a - b) ** 2 for a, b in zip(p, q)) == pytest.approx(36)


def test_flat_face_has_width_and_height(block):
    face = find(block, "face", Width=40, Height=30)[0]
    texts = sorted(d["text"] for d in dims(measure(block, Selection(faces=[face]))))
    assert texts == ["30", "40"]


def test_vertex_tag_and_group_dimensions(block):
    (tag,) = dims(measure(block, Selection(vertices=[0])))
    assert tag["kind"] == "tag" and tag["text"].startswith("(")
    edges = find(block, "edge", Length=40)[:1] + find(block, "edge", Length=30)[:1]
    (total,) = dims(measure(block, Selection(edges=edges)))  # skew/adjacent pair: distance replaces total
    assert total["kind"] in ("linear", "tag")
    four = find(block, "edge", Length=40)
    (sigma,) = dims(measure(block, Selection(edges=four[:3])))
    assert sigma["text"] == "Σ 120"


def test_model_info(bracket):
    from pliable.measure import model_info

    rows = {r["label"]: r["value"] for r in model_info(bracket)["items"][0]["rows"]}
    assert rows["Valid"] == "yes"
    assert rows["Solids"] == 1 and rows["Faces"] == 19 and rows["Open edges"] == 0
    assert rows["Size (X, Y, Z)"] == pytest.approx([80, 50, 50])


def test_hole_centre_and_centre_distances(bracket):
    holes = [i for i in range(bracket.face_count) if measure(bracket, Selection(faces=[i]))["items"][0]["title"] == "Cylinder" and abs(measure(bracket, Selection(faces=[i]))["items"][0]["rows"][0]["value"] - 4) < 1e-6]
    assert len(holes) == 4
    rows = {r["label"]: r["value"] for r in measure(bracket, Selection(faces=[holes[0]]))["items"][0]["rows"]}
    assert {"Centre X", "Centre Y", "Centre Z"} <= set(rows)
    pair = measure(bracket, Selection(faces=holes[:2]))
    distances = {round(r["value"], 3) for r in pair["summary"] if r["label"] == "Centre distance"}
    assert distances and distances <= {28.0, 35.0, round(math.hypot(35, 28), 3)}
    assert pair["dimensions"][0]["kind"] == "linear"


def test_model_info_for_one_body_of_two():
    from build123d import Box, Compound, Pos

    from pliable import bodies as body_ids
    from pliable.measure import model_info
    from pliable.topology import Topology

    shape = Compound([Box(10, 10, 10), Pos(30, 0, 0) * Box(20, 20, 20)]).wrapped
    state = body_ids.fresh(shape, body_ids.namer({}))
    topology = Topology(shape, state)
    both = {r["label"]: r["value"] for r in model_info(topology)["items"][0]["rows"]}
    assert both["Solids"] == 2 and both["Faces"] == 12
    second = state.bodies[1]
    item = model_info(topology, second.id)["items"][0]
    rows = {r["label"]: r["value"] for r in item["rows"]}
    assert item["title"] == second.name and rows["Solids"] == 1 and rows["Faces"] == 6
    assert rows["Volume"] != pytest.approx(both["Volume"]) and rows["Volume"] == pytest.approx(rows["Size (X, Y, Z)"][0] ** 3)
    with pytest.raises(ValueError):
        model_info(topology, 999)
