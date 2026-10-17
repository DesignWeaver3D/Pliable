import base64
import json

import pytest
from build123d import Box
from build123d.topology import Shape

from pliable.demos import DEMOS, load_demo
from pliable.document import Document
from pliable.files import read_step, write_step
from pliable.ops import OperationError, planar_normal, push_pull
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
    curved = next(face for _, face in topology.faces() if planar_normal(face) is None)
    with pytest.raises(OperationError):
        push_pull(topology.shape, curved, 2)


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
    preview = session.handle({"type": "preview_push_pull", "face": face, "distance": 3})
    header, _ = decode_binary(preview)
    assert header["preview"] and not session.document.can_undo
    commit = session.handle({"type": "commit_push_pull", "face": face, "distance": 3})
    header, _ = decode_binary(commit)
    assert header["canUndo"] and header["selection"] == [top_face(session.document.current)]
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
