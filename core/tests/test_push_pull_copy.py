"""Push/pull with Copy on keeps the original body and makes the pushed or pulled result a new body."""

import pytest

from pliable.demos import load_demo
from pliable.ops import planar_normal, solids_of
from pliable.tools import Selection, get_tool
from pliable.topology import Topology
from pliable.volume import volume_of


def _top_face(topology):
    return next(i for i, f in topology.faces() if planar_normal(f) is not None and planar_normal(f).Z() > 0.99 and abs(planar_normal(f).X()) < 1e-6)


def _run(distance, **params):
    topology = Topology(load_demo("block"))
    return topology, get_tool("push_pull").execute(topology, Selection(faces=[_top_face(topology)]), {"distance": distance, **params}, preview=False)


def _volumes(shape):
    return [volume_of(s) for s in solids_of(shape)]


def test_copy_off_changes_the_body():
    before, result = _run(5)
    assert len(solids_of(result.shape)) == 1
    assert _volumes(result.shape)[0] == pytest.approx(_volumes(before.shape)[0] * 25 / 20, rel=1e-6)


@pytest.mark.parametrize("distance,factor", [(5, 25 / 20), (-5, 15 / 20)])
def test_copy_on_keeps_the_original_and_adds_a_new_body(distance, factor):
    before, result = _run(distance, copy=True)
    original = _volumes(before.shape)[0]
    volumes = _volumes(result.shape)
    assert len(volumes) == 2
    assert volumes[0] == pytest.approx(original, rel=1e-9)
    assert solids_of(result.shape)[0].IsSame(solids_of(before.shape)[0])
    assert volumes[1] == pytest.approx(original * factor, rel=1e-6)
    assert result.tracked_faces and planar_normal(result.tracked_faces[0]) is not None


def test_copy_on_a_loose_region_is_ignored():
    from test_push_pull_modes import loose_region

    shape, face = loose_region((0, 0, 1), (1, 0, 0), 10, False)
    topology = Topology(shape)
    plain = get_tool("push_pull").execute(topology, Selection(faces=[face]), {"distance": 4}, preview=False)
    copied = get_tool("push_pull").execute(topology, Selection(faces=[face]), {"distance": 4, "copy": True}, preview=False)
    assert sorted(_volumes(copied.shape)) == pytest.approx(sorted(_volumes(plain.shape)))
