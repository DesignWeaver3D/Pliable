"""Which tools the strip may offer: with nothing selected only tools that really work without a selection."""

from pliable.holes import find_hole
from pliable.ops import OperationError
from pliable.server import Session
from pliable.tools import TOOLS, Selection


def _available(session, selection):
    return set(session.handle({"type": "available_tools", "selection": selection})["tools"])


def _bracket():
    s = Session()
    s.handle({"type": "open_demo", "name": "bracket"})
    return s


def test_nothing_selected_offers_only_tools_that_need_no_selection():
    got = _available(_bracket(), {})
    assert got == {
        # new primitives
        "add_box", "add_cylinder", "add_sphere", "add_cone", "add_torus", "add_prism",
        # whole-model tools (the demo has a single body, so "the whole model" is unambiguous)
        "unify", "cut_plane", "split_plane", "offset_body", "linear_array", "circular_array", "concentric_array", "mirror",
        "move_body", "rotate_body", "scale_body",
    }  # fmt: skip
    for hole_tool in ("edit_hole", "convert_to_countersink", "resize_hole", "move_hole", "fill_hole"):
        assert hole_tool not in got


def test_whole_model_tools_need_a_selected_body_when_there_are_several():
    s = _bracket()
    s.handle({"type": "tool_commit", "tool": "add_box", "params": {"width": 5, "depth": 5, "height": 5, "x": 100, "new_body": 1}})
    got = _available(s, {})
    assert {"move_body", "offset_body", "linear_array", "circular_array", "concentric_array"}.isdisjoint(got)
    assert {"add_box", "unify", "cut_plane"} <= got


def test_a_hole_face_offers_the_hole_tools():
    s = _bracket()
    topology = s._require_document().current
    face = None
    for i in range(topology.face_count):
        try:
            find_hole(topology, reach=False, face_id=i)
        except OperationError:
            continue
        face = i
        break
    assert face is not None
    got = _available(s, {"faces": [face]})
    assert {"edit_hole", "convert_to_countersink"} <= got


def test_hole_tools_declare_that_they_need_a_selection():
    # Their ranges allow zero faces and zero edges (one of either is enough), so any_of must say nothing is not enough.
    for tool_id in ("edit_hole", "convert_to_countersink"):
        assert TOOLS[tool_id].accepts.any_of
        assert TOOLS[tool_id].describe()["accepts"]["anyOf"] is True
        assert not TOOLS[tool_id].accepts.matches(Selection())
    assert TOOLS["convert_to_countersink"].label == "Add countersink to hole"


def test_selecting_a_face_of_a_large_model_checks_the_tools_quickly():
    """Regression: the Edit cut check walked a plate with 400 faces in about 1.5 s because iterating an edge's face list is slow."""
    import time

    s = Session()
    s.handle({"type": "open_demo", "name": "perforated_plate"})
    s.handle({"type": "available_tools", "selection": {"faces": [0]}})  # warm the edge-to-face map
    start = time.perf_counter()
    s.handle({"type": "available_tools", "selection": {"faces": [0]}})
    assert time.perf_counter() - start < 0.8


def test_edge_faces_lists_each_adjacent_face():
    topology = _bracket()._require_document().current
    counts = {len(topology.edge_faces(edge)) for _, edge in topology.edges()}
    assert counts <= {1, 2} and 2 in counts
    edge = topology.edge(0)
    assert all(topology.face_id(f) is not None for f in topology.edge_faces(edge))
