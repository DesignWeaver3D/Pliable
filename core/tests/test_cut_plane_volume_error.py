"""Cut with plane trusts the volumes of the two halves; the small error of a curved body must not read as a miss."""

from pliable.demos import load_demo
from pliable.ops import solids_of
from pliable.tools import Selection, cut_plane, get_tool  # noqa: F401
from pliable.topology import Topology


def test_a_plane_through_the_model_is_not_reported_as_missing_when_volumes_differ_slightly(monkeypatch):
    real = cut_plane._volume
    calls = []

    def noisy(shape):
        calls.append(1)
        value = real(shape)
        return value * (1 - 2e-6) if len(calls) in (2, 3) else value  # the two halves come out 2 parts in a million small

    monkeypatch.setattr(cut_plane, "_volume", noisy)
    body = Topology(load_demo("block"))
    result = get_tool("cut_plane").execute(body, Selection(), {"axis": 1, "position": 0, "remove_side": 0}, preview=False)
    assert len(solids_of(result.shape)) == 2
