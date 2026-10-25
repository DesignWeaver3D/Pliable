import base64

import pytest
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.gp import gp_Vec

from pliable.demos import load_demo
from pliable.shared.solids import combine
from pliable.files import write_step
from pliable.ops import OperationError
from pliable.server import Session


def volume(shape) -> float:
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return props.Mass()


def test_combine_modes_and_server_request():
    block = load_demo("block")  # 40 x 30 x 20
    shifted = gp_Vec(20, 0, 0)  # overlaps half of the block
    assert volume(combine(block, block, "union", shifted).shape) == pytest.approx(24000 + 12000)
    assert volume(combine(block, block, "cut", shifted).shape) == pytest.approx(12000)
    assert volume(combine(block, block, "intersect", shifted).shape) == pytest.approx(12000)
    from pliable.ops import solids_of

    added = combine(block, block, "add", gp_Vec(100, 0, 0)).shape
    assert len(solids_of(added)) == 2 and volume(added) == pytest.approx(48000)
    with pytest.raises(OperationError):
        combine(block, block, "intersect", gp_Vec(100, 0, 0))
    with pytest.raises(OperationError):
        combine(block, block, "bogus")
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    reply = session.handle({"type": "combine_step", "data": base64.b64encode(write_step(block)).decode(), "mode": "union", "dx": 20})
    assert isinstance(reply, bytes) and session.document.can_undo
