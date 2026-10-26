"""The cut-with-plane preview reports the body each side would give."""

from pliable.protocol import decode_binary
from pliable.server import Session


def preview(session, side):
    params = {"axis": 3, "nx": 0, "ny": 0, "nz": 1.0, "position": 5, "remove_side": side}
    header, _ = decode_binary(session.handle({"type": "tool_preview", "tool": "cut_plane", "selection": {}, "params": params}))
    return header


def test_preview_names_the_body_on_each_side():
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    sides = preview(session, 0)["sides"]
    assert len(sides) == 2 and None not in sides and sides[0] != sides[1]
    assert preview(session, 1)["sides"] == sides  # the same two bodies whichever side is removed


def test_edge_faces_lists_the_faces_beside_an_edge():
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    reply = session.handle({"type": "edge_faces", "edge": 0})
    assert len(reply["faces"]) == 2
