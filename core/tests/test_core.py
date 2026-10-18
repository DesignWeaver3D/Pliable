import base64
import json

import pytest
from OCP.Bnd import Bnd_Box
from OCP.BRep import BRep_Tool
from OCP.BRepBndLib import BRepBndLib
from OCP.TopoDS import TopoDS
from build123d import Box
from build123d.topology import Shape

from pliable.demos import DEMOS, load_demo
from pliable.document import Document
from pliable.files import read_step, write_step
from pliable.ops import OperationError, edge_outward_normal, fillet_chamfer, planar_normal, push_pull
from pliable.protocol import decode_binary, encode_mesh
from pliable.server import Session
from pliable.tessellate import tessellate
from pliable.topology import Topology


def volume(shape) -> float:
    return Shape.cast(shape).volume


def top_face(topology: Topology) -> int:
    """Id of the planar face whose outward normal points most along +Z."""
    best = max(
        (planar_normal(face).Z(), face_id) for face_id, face in topology.faces() if planar_normal(face) is not None
    )
    return best[1]


@pytest.fixture
def box_topology():
    return Topology(Box(10, 10, 10).wrapped)


def test_push_pull_adds_material(box_topology):
    face = box_topology.face(top_face(box_topology))
    result = push_pull(box_topology.shape, face, 5)
    assert volume(result.shape) == pytest.approx(1500)


def test_push_pull_removes_material(box_topology):
    face = box_topology.face(top_face(box_topology))
    result = push_pull(box_topology.shape, face, -4)
    assert volume(result.shape) == pytest.approx(600)


def test_push_pull_keeps_box_clean(box_topology):
    face = box_topology.face(top_face(box_topology))
    result = push_pull(box_topology.shape, face, 5)
    # Coplanar side faces are merged, so the result is still a 6-face box.
    assert Topology(result.shape).face_count == 6


def test_push_pull_tracks_moved_face(box_topology):
    face = box_topology.face(top_face(box_topology))
    result = push_pull(box_topology.shape, face, 5)
    new = Topology(result.shape)
    ids = [new.face_id(f) for f in result.tracked_faces]
    assert len(ids) == 1 and ids[0] is not None
    assert ids[0] == top_face(new)


def test_push_pull_rejects_curved_faces():
    from build123d import Cylinder

    topology = Topology(Cylinder(5, 10).wrapped)
    from pliable.tools import Selection, get_tool

    curved = next(i for i, face in topology.faces() if planar_normal(face) is None)
    tool = get_tool("push_pull")  # curved faces have their own tool, Emboss/Cut along surface
    assert not tool.available(topology, Selection(faces=[curved]))
    with pytest.raises(OperationError):
        tool.execute(topology, Selection(faces=[curved]), {"distance": 2}, preview=False)


def test_tessellation_covers_every_face(box_topology):
    mesh = tessellate(box_topology)
    assert len(mesh.faces) == 6
    assert sum(f["count"] for f in mesh.faces) == mesh.indices.size
    assert mesh.indices.max() < len(mesh.positions)
    assert len(mesh.edges) == 12
    assert len(mesh.edge_positions) % 2 == 0


def test_tessellation_normals_point_outward(box_topology):
    mesh = tessellate(box_topology)
    face = mesh.faces[top_face(box_topology)]
    tri = mesh.indices[face["start"] : face["start"] + 3]
    a, b, c = mesh.positions[tri]
    import numpy as np

    winding_normal = np.cross(b - a, c - a)
    assert winding_normal[2] > 0
    assert face["normal"] == pytest.approx([0, 0, 1])


def test_mesh_round_trips_through_protocol(box_topology):
    mesh = tessellate(box_topology)
    header, buffers = decode_binary(encode_mesh({"kind": "mesh"}, mesh))
    assert header["kind"] == "mesh"
    assert len(header["faces"]) == 6
    assert (buffers["indices"] == mesh.indices).all()
    assert (buffers["positions"] == mesh.positions.ravel()).all()


def test_document_undo_redo():
    document = Document(Box(1, 1, 1).wrapped)
    first = document.current
    document.commit(Box(2, 2, 2).wrapped)
    assert document.undo() and document.current is first
    assert document.redo() and volume(document.current.shape) == pytest.approx(8)
    document.undo()
    document.commit(Box(3, 3, 3).wrapped)
    assert not document.can_redo


def test_step_round_trip(box_topology):
    shape = read_step(write_step(box_topology.shape))
    assert volume(shape) == pytest.approx(1000)


@pytest.mark.parametrize("name", list(DEMOS))
def test_demos_are_valid(name):
    from OCP.BRepCheck import BRepCheck_Analyzer

    assert BRepCheck_Analyzer(load_demo(name)).IsValid()


def test_session_push_pull_flow():
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    face = top_face(session.document.current)
    preview = session.handle({"type": "tool_preview", "tool": "push_pull", "selection": {"faces": [face]}, "params": {"distance": 3}})
    header, _ = decode_binary(preview)
    assert header["preview"] and not session.document.can_undo
    commit = session.handle({"type": "tool_commit", "tool": "push_pull", "selection": {"faces": [face]}, "params": {"distance": 3}})
    header, _ = decode_binary(commit)
    assert header["canUndo"] and header["selection"] == {"faces": [top_face(session.document.current)], "edges": [], "vertices": []}
    exported = session.handle({"type": "export_step"})
    assert volume(read_step(base64.b64decode(exported["data"]))) == pytest.approx(40 * 30 * 23)
    json.dumps(exported)


@pytest.mark.parametrize("preview", [True, False])
def test_push_pull_leaves_source_shape_untouched(preview):
    from OCP.BRepCheck import BRepCheck_Analyzer

    topology = Topology(load_demo("bracket"))
    face = topology.face(top_face(topology))
    for distance in (2, -3, 4, -1):
        push_pull(topology.shape, face, distance, preview=preview)
        assert BRepCheck_Analyzer(topology.shape).IsValid()


def test_tool_registry_describes_push_pull():
    reply = Session().handle({"type": "list_tools"})
    (tool,) = [t for t in reply["tools"] if t["id"] == "push_pull"]
    assert tool["accepts"] == {"faces": [1, None], "edges": [0, 0], "vertices": [0, 0]}
    assert tool["params"] == [{"name": "distance", "kind": "length", "default": 0.0, "drag": True}]
    json.dumps(reply)


def test_available_tools_follow_selection():
    session = Session()
    session.handle({"type": "open_demo", "name": "bracket"})
    topology = session.document.current
    planar = top_face(topology)
    curved = next(i for i, f in topology.faces() if planar_normal(f) is None)

    def available(selection):
        return session.handle({"type": "available_tools", "selection": selection})["tools"]

    assert {"push_pull", "add_hole", "delete_face"} <= set(available({"faces": [planar]}))
    assert not {"resize_hole", "fillet_chamfer"} & set(available({"faces": [planar]}))
    assert "push_pull" not in available({"faces": [curved]})
    assert "delete_face" in available({"faces": [curved]})
    assert "push_pull" not in available({"faces": [planar, curved]})
    assert "push_pull" not in available({})
    assert available({"faces": [9999]}) == []


def test_measure_request():
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    reply = session.handle({"type": "measure", "selection": {"edges": [0, 1]}})
    assert len(reply["items"]) == 2 and reply["items"][0]["kind"] == "edge"
    assert reply["summary"][0] == {"label": "Selected", "value": 2, "unit": ""}
    json.dumps(reply)  # must be plain JSON data
    with pytest.raises(Exception):
        session.handle({"type": "measure", "selection": {"edges": [9999]}})


def test_tool_rejects_bad_requests():
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    face = top_face(session.document.current)
    selection = {"faces": [face]}
    with pytest.raises(OperationError):
        session.handle({"type": "tool_preview", "tool": "nope", "selection": selection})
    with pytest.raises(OperationError):
        session.handle({"type": "tool_preview", "tool": "push_pull", "selection": {}, "params": {"distance": 1}})
    with pytest.raises(OperationError):
        session.handle({"type": "tool_preview", "tool": "push_pull", "selection": selection, "params": {"distance": "x"}})


def test_mesh_has_vertices(box_topology):
    mesh = tessellate(box_topology)
    assert len(mesh.vertices) == 8
    header, _ = decode_binary(encode_mesh({}, mesh))
    assert len(header["vertices"]) == 8 and len(header["vertices"][0]["position"]) == 3


def test_push_pull_carries_edges_and_vertices(box_topology):
    top = top_face(box_topology)
    # An edge and a vertex on the bottom survive pulling the top face.
    low_edge = min(box_topology.edges(), key=lambda ie: _centre_z(ie[1]))[0]
    low_vertex = min(box_topology.vertices(), key=lambda iv: BRep_Tool.Pnt_s(iv[1]).Z())[0]
    result = push_pull(
        box_topology.shape,
        box_topology.face(top),
        3,
        follow_edges=[box_topology.edge(low_edge)],
        follow_vertices=[box_topology.vertex(low_vertex)],
    )
    new = Topology(result.shape)
    (edge,) = result.tracked_edges
    (vertex,) = result.tracked_vertices
    assert new.edge_id(edge) is not None and new.vertex_id(vertex) is not None
    assert BRep_Tool.Pnt_s(TopoDS.Vertex(vertex)).Z() == pytest.approx(BRep_Tool.Pnt_s(box_topology.vertex(low_vertex)).Z())


def _centre_z(edge):
    box = Bnd_Box()
    BRepBndLib.Add_s(edge, box)
    return (box.CornerMin().Z() + box.CornerMax().Z()) / 2


def _top_edge_of_box(topology):
    """An edge on the top face of the box, on its +x side."""
    best = None
    for i, edge in topology.edges():
        box = Bnd_Box()
        BRepBndLib.Add_s(edge, box)
        low, high = box.CornerMin(), box.CornerMax()
        if abs(low.Z() - 5) < 1e-6 and abs(high.Z() - 5) < 1e-6 and abs(low.X() - 5) < 1e-6 and abs(high.X() - 5) < 1e-6:
            best = i
    return best


def test_edge_outward_normal_bisects_adjacent_faces(box_topology):
    edge = box_topology.edge(_top_edge_of_box(box_topology))
    n = edge_outward_normal(box_topology, edge)
    assert n == pytest.approx([2**-0.5, 0, 2**-0.5])


def test_fillet_removes_expected_volume(box_topology):
    edge = box_topology.edge(_top_edge_of_box(box_topology))
    result = fillet_chamfer(box_topology.shape, [edge], 2)
    # A quarter-circle of radius r removes (1 - pi/4) r^2 per unit length.
    assert volume(result.shape) == pytest.approx(1000 - (1 - 3.141592653589793 / 4) * 4 * 10)
    assert len(result.tracked_faces) == 1


def test_chamfer_removes_expected_volume(box_topology):
    edge = box_topology.edge(_top_edge_of_box(box_topology))
    result = fillet_chamfer(box_topology.shape, [edge], -2)
    assert volume(result.shape) == pytest.approx(1000 - 0.5 * 2 * 2 * 10)


def test_fillet_too_large_fails_cleanly(box_topology):
    edge = box_topology.edge(_top_edge_of_box(box_topology))
    with pytest.raises(OperationError):
        fillet_chamfer(box_topology.shape, [edge], 50)


def test_fillet_chamfer_tool_through_session():
    session = Session()
    session.handle({"type": "open_demo", "name": "bracket"})
    topology = session.document.current
    reply = session.handle({"type": "available_tools", "selection": {"edges": [0]}})
    assert {"fillet_chamfer", "variable_fillet"} <= set(reply["tools"])  # edge tools; others may be added over time
    frame = session.handle(
        {"type": "tool_commit", "tool": "fillet_chamfer", "selection": {"edges": [27]}, "params": {"distance": 1}}
    )
    header, _ = decode_binary(frame)
    assert header["canUndo"] and len(header["faces"]) > topology.face_count
    assert header["edges"][0]["normal"] is None or len(header["edges"][0]["normal"]) == 3


@pytest.mark.parametrize("fmt, marker", [("stl", None), ("obj", b"v "), ("3mf", b"PK")])
def test_export_mesh_formats(fmt, marker):
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    data = base64.b64decode(session.handle({"type": "export_mesh", "format": fmt})["data"])
    assert len(data) > 200
    if marker:
        assert marker in data[:2000] or data.startswith(marker)
    with pytest.raises(Exception):
        session.handle({"type": "export_mesh", "format": "dxf"})


def test_notice_acknowledgement_is_per_user_and_survives_instances(tmp_path, monkeypatch):
    from pliable import notice
    from pliable.autosave import Autosaver

    monkeypatch.setenv("PLIABLE_DATA", str(tmp_path))
    first = Session(Autosaver(tmp_path))
    assert first.handle({"type": "notice_get"}) == {"acknowledged": False, "epoch": notice.NOTICE_EPOCH}
    first.handle({"type": "notice_ack"})
    other = Session(Autosaver(tmp_path))  # another instance reads the same user-level file
    assert other.handle({"type": "notice_get"})["acknowledged"] is True
    assert (tmp_path / "notice.json").exists() and not list(tmp_path.glob("*.tmp"))
    monkeypatch.setattr(notice, "NOTICE_EPOCH", notice.NOTICE_EPOCH + 1)  # risks changed: ask again
    assert other.handle({"type": "notice_get"})["acknowledged"] is False


def test_notice_survives_a_corrupt_file(tmp_path, monkeypatch):
    monkeypatch.setenv("PLIABLE_DATA", str(tmp_path))
    (tmp_path / "notice.json").write_text("{not json")
    session = Session()
    assert session.handle({"type": "notice_get"})["acknowledged"] is False
    session.handle({"type": "notice_ack"})
    assert session.handle({"type": "notice_get"})["acknowledged"] is True
