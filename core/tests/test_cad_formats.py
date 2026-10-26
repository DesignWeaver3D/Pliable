"""Import and export of the CAD formats the kernel handles: STEP, compressed STEP, IGES and BREP."""

import base64
import math

import pytest

from pliable import files
from pliable.server import Session


def volume(session):
    return files._volume(session.document.current.shape)


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
    assert volume(target) == pytest.approx(volume(source), rel=1e-4)


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


def make_3dm(*breps):
    import os
    import tempfile

    import rhino3dm

    model = rhino3dm.File3dm()
    for brep in breps:
        model.Objects.AddBrep(brep)
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "in.3dm")
        assert model.Write(path, 7)
        with open(path, "rb") as f:
            return base64.b64encode(f.read()).decode()


@pytest.mark.parametrize("name, expected", [("box", 2 * 3 * 4), ("cylinder", math.pi * 25 * 10), ("sphere", 4 / 3 * math.pi * 125)])
def test_3dm_import_of_solids(name, expected):
    import rhino3dm

    if name == "box":
        brep = rhino3dm.Brep.CreateFromBox(rhino3dm.Box(rhino3dm.BoundingBox(rhino3dm.Point3d(0, 0, 0), rhino3dm.Point3d(2, 3, 4))))
    elif name == "cylinder":
        brep = rhino3dm.Brep.CreateFromCylinder(rhino3dm.Cylinder(rhino3dm.Circle(5.0), 10.0), True, True)
    else:
        brep = rhino3dm.Brep.CreateFromSphere(rhino3dm.Sphere(rhino3dm.Point3d(0, 0, 0), 5.0))
    session = Session()
    session.handle({"type": "import_step", "name": f"{name}.3dm", "extension": "3dm", "data": make_3dm(brep)})
    assert len(session.document.current.bodies.bodies) == 1
    assert volume(session) == pytest.approx(expected, rel=2e-2 if name == "sphere" else 1e-3)  # the kernel integrates a whole NURBS sphere only roughly


def test_3dm_export_and_empty_file():
    source = Session()
    source.handle({"type": "open_demo", "name": "bracket"})
    exported = source.handle({"type": "export_cad", "format": "3dm"})
    target = Session()
    with pytest.raises(Exception, match="no surfaces or solids"):  # meshes are not read back
        target.handle({"type": "import_step", "extension": "3dm", "data": exported["data"]})
    import rhino3dm

    model = rhino3dm.File3dm.FromByteArray(base64.b64decode(exported["data"]))
    assert len(model.Objects) == len(source.document.current.bodies.bodies)


@pytest.mark.parametrize("demo", ["bracket", "block"])
def test_ifc_round_trip(demo):
    pytest.importorskip("ifcopenshell")
    source = Session()
    source.handle({"type": "open_demo", "name": demo})
    exported = source.handle({"type": "export_cad", "format": "ifc"})
    raw = base64.b64decode(exported["data"])
    assert raw.startswith(b"ISO-10303-21") and b"IFCBUILDINGELEMENTPROXY" in raw and b"IFCFACETEDBREP" in raw
    for body in source.document.current.bodies.bodies:
        assert body.name.encode() in raw
    target = Session()
    target.handle({"type": "import_step", "name": "x.ifc", "extension": "ifc", "data": exported["data"]})
    assert len(target.document.current.bodies.bodies) == len(source.document.current.bodies.bodies)
    assert [b.name for b in target.document.current.bodies.bodies] == [b.name for b in source.document.current.bodies.bodies]
    assert volume(target) == pytest.approx(volume(source), rel=1e-3)


def test_ifc_skipped_elements_and_bad_file():
    pytest.importorskip("ifcopenshell")
    import ifcopenshell
    import ifcopenshell.api

    source = Session()
    source.handle({"type": "open_demo", "name": "bracket"})
    raw = base64.b64decode(source.handle({"type": "export_cad", "format": "ifc"})["data"])
    import os
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "a.ifc")
        with open(path, "wb") as f:
            f.write(raw)
        model = ifcopenshell.open(path)
        ifcopenshell.api.run("root.create_entity", model, ifc_class="IfcSpace", name="Room")
        model.write(path)
        with open(path, "rb") as f:
            data = base64.b64encode(f.read()).decode()
    target = Session()
    reply = target.handle({"type": "import_step", "name": "a.ifc", "extension": "ifc", "data": data})
    assert reply is not None
    assert volume(target) == pytest.approx(volume(source), rel=1e-3)
    assert any("space" in w for w in files.read_step_parts(base64.b64decode(data), "ifc")[1])
    with pytest.raises(Exception, match="ifc"):
        target.handle({"type": "import_step", "extension": "ifc", "data": base64.b64encode(b"not ifc").decode()})


def test_ifc_curved_solid_is_close():
    pytest.importorskip("ifcopenshell")
    from build123d import Cylinder

    from pliable.filesifc import read_ifc, write_ifc

    cylinder = Cylinder(5, 10)
    root, notes = read_ifc(write_ifc(cylinder.wrapped, ["Pin"]))
    assert root.children[0].label == "Pin" and len(root.solids()) == 1
    assert files._volume(root.wrapped) == pytest.approx(cylinder.volume, rel=1e-3)
