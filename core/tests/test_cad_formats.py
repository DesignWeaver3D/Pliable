"""Import and export of the CAD formats the kernel handles: STEP, compressed STEP, IGES and BREP."""

import base64

import pytest

from pliable.server import Session


def volume(session):
    reply = session.handle({"type": "measure", "selection": {"bodies": [0]}})
    return reply


@pytest.mark.parametrize("fmt, extension, marker", [("step", "step", b"ISO-10303"), ("stp", "stp", b"ISO-10303"), ("stpz", "stpZ", b"\x1f\x8b"), ("iges", "igs", b"S"), ("brep", "brp", b"CASCADE")])
def test_cad_round_trip(fmt, extension, marker):
    source = Session()
    source.handle({"type": "open_demo", "name": "bracket"})
    exported = source.handle({"type": "export_cad", "format": fmt})
    raw = base64.b64decode(exported["data"])
    assert marker in raw[:200] or raw.startswith(marker)
    target = Session()
    reply = target.handle({"type": "import_step", "name": f"x.{extension}", "extension": extension, "data": exported["data"]})
    assert reply is not None
    assert len(target.document.current.bodies.bodies) == len(source.document.current.bodies.bodies)
    assert target.document.current.face_count >= source.document.current.face_count - 2


def test_import_into_the_session_and_bad_files():
    session = Session()
    session.handle({"type": "open_demo", "name": "block"})
    other = base64.b64encode(base64.b64decode(session.handle({"type": "export_cad", "format": "brep"})["data"])).decode()
    session.handle({"type": "combine_step", "extension": "brep", "data": other, "mode": "union", "dx": 100})
    assert len(session.document.current.bodies.bodies) == 2
    with pytest.raises(Exception):
        session.handle({"type": "export_cad", "format": "dxf"})
    with pytest.raises(Exception):
        session.handle({"type": "import_step", "extension": "igs", "data": base64.b64encode(b"not iges").decode()})
    with pytest.raises(Exception):
        session.handle({"type": "import_step", "extension": "txt", "data": ""})
