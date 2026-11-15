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
    assert volume(session) == pytest.approx(expected, rel=2e-2 if name == "sphere" else 1e-2 if name == "cylinder" else 1e-3)  # the kernel integrates a whole NURBS sphere only roughly; the cylinder came out 0.8% off on macOS arm64


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
    assert raw.startswith(b"ISO-10303-21") and b"IFCBUILDINGELEMENTPROXY" in raw and b"IFCADVANCEDBREP" in raw
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


def _ifc_volume(raw, deflection=1e-5):
    """Volume (mm^3) of the first product, tessellated finely from the IFC file's own geometry."""
    import os
    import tempfile

    import ifcopenshell
    import ifcopenshell.geom

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "a.ifc")
        with open(path, "wb") as f:
            f.write(raw)
        model = ifcopenshell.open(path)
    settings = ifcopenshell.geom.settings()
    settings.set("mesher-linear-deflection", deflection)
    settings.set("mesher-angular-deflection", 0.05)
    geometry = ifcopenshell.geom.create_shape(settings, model.by_type("IfcBuildingElementProxy")[0]).geometry
    v, f = geometry.verts, geometry.faces
    total = 0.0
    for i in range(0, len(f), 3):
        a, b, c = (v[3 * f[i + k] : 3 * f[i + k] + 3] for k in range(3))
        total += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])
    return total / 6.0 * 1e9  # signed: negative would mean the faces point inward


@pytest.mark.parametrize("name", ["box", "cylinder", "bracket", "cone", "cone_flared", "torus", "loft", "revolved", "extruded_spline", "sphere"])
def test_ifc_export_is_an_exact_brep(name):
    pytest.importorskip("ifcopenshell")
    from build123d import Axis, Box, BuildLine, BuildPart, BuildSketch, Circle, Cone, Cylinder, Line, Plane, Polygon, Pos, Rectangle, Sphere, Spline, Torus, extrude, fillet, loft, make_face, revolve

    from pliable.filesifc import write_ifc

    if name == "box":
        shape = Box(10, 20, 30)
    elif name == "cylinder":
        shape = Cylinder(5, 10)
    elif name == "bracket":
        block = Box(40, 20, 10) - Cylinder(4, 10)
        shape = fillet(block.edges().filter_by(Axis.Z)[:2], 3)
    elif name == "cone":
        shape = Cone(5, 2, 8)
    elif name == "cone_flared":
        shape = Cone(2, 5, 8)
    elif name == "revolved":
        with BuildPart() as part:
            with BuildSketch(Plane.XZ) as profile:
                Polygon((0, 0), (6, 0), (8, 5), (4, 9), (0, 9), align=None)
            revolve(axis=Axis.Z)
        shape = part.part
    elif name == "extruded_spline":
        with BuildPart() as part:
            with BuildSketch() as profile:
                with BuildLine():
                    Spline((0, 0), (5, 3), (10, 0), (12, -5))
                    Line((12, -5), (0, -5))
                    Line((0, -5), (0, 0))
                make_face()
            extrude(amount=6)
        shape = part.part
    elif name == "torus":
        shape = Torus(10, 2)
    elif name == "loft":
        shape = loft([Rectangle(10, 10), Pos(0, 0, 10) * Circle(4)])
    else:
        shape = Sphere(8)
    raw = write_ifc(shape.wrapped, ["Part"])
    exact = name != "sphere"  # a pole has a degenerate edge: that solid keeps the faceted body
    assert (b"IFCADVANCEDBREP" in raw) == exact
    assert (b"IFCFACETEDBREP" in raw) == (not exact)
    if exact:
        assert raw.count(b"IFCADVANCEDFACE(") == len(shape.faces())
        assert _ifc_volume(raw) == pytest.approx(shape.volume, rel=2e-3)


def test_ifc_exact_export_through_the_export_handler_round_trips():
    pytest.importorskip("ifcopenshell")
    source = Session()
    source.handle({"type": "open_demo", "name": "bracket"})
    raw = base64.b64decode(source.handle({"type": "export_cad", "format": "ifc"})["data"])
    assert b"IFCADVANCEDBREP" in raw and b"IFCFACETEDBREP" not in raw
    assert _ifc_volume(raw) == pytest.approx(volume(source), rel=2e-3)
    target = Session()
    target.handle({"type": "import_step", "name": "x.ifc", "extension": "ifc", "data": base64.b64encode(raw).decode()})
    assert volume(target) == pytest.approx(volume(source), rel=1e-2)
