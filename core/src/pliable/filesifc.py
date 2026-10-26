"""IFC import and export through IfcOpenShell, loaded only when an .ifc file is used.

Import triangulates every product that has a body (IfcOpenShell's geometry iterator), sews the triangles into a shell and makes
a solid where the shell closes; coplanar triangles are merged back into whole faces. Openings, spaces and products without
geometry are skipped and the import says how many. Export writes each solid as an IfcBuildingElementProxy named after the
body, with a faceted B-rep body in millimetres; curved faces become triangles, so the file is lossy like a mesh file."""

from __future__ import annotations

import os
import tempfile

from build123d import Compound, Shape
from OCP.BRep import BRep_Tool
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakePolygon, BRepBuilderAPI_Sewing
from OCP.gp import gp_Pnt
from OCP.ShapeFix import ShapeFix_Shape, ShapeFix_Solid
from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain
from OCP.TopAbs import TopAbs_SHELL
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS, TopoDS_Shape

SKIPPED_CLASSES = ("IfcOpeningElement", "IfcSpace")  # voids and room volumes are not parts
SEW_TOLERANCE = 1e-3  # model units (mm)
MISSING = "Reading and writing .ifc files needs the optional IfcOpenShell package. Install it with: pip install ifcopenshell (or uv sync --extra ifc)"


def _import_ifc():
    try:
        import ifcopenshell
    except ImportError as e:
        raise ValueError(MISSING) from e
    return ifcopenshell


def _solid_from_triangles(points, faces):
    """A kernel shape (a solid when the triangles close) from a triangle list; None if nothing usable."""
    sewing = BRepBuilderAPI_Sewing(SEW_TOLERANCE)
    added = 0
    for a, b, c in faces:
        triple = (points[a], points[b], points[c])
        if len({tuple(round(x, 6) for x in p) for p in triple}) < 3:
            continue
        polygon = BRepBuilderAPI_MakePolygon(gp_Pnt(*triple[0]), gp_Pnt(*triple[1]), gp_Pnt(*triple[2]), True)
        if not polygon.IsDone():
            continue
        face = BRepBuilderAPI_MakeFace(polygon.Wire(), True)
        if face.IsDone():
            sewing.Add(face.Face())
            added += 1
    if not added:
        return None
    sewing.Perform()
    sewn = sewing.SewedShape()
    explorer = TopExp_Explorer(sewn, TopAbs_SHELL)
    if explorer.More():
        shell = TopoDS.Shell(explorer.Current())
        if BRep_Tool.IsClosed_s(shell):
            solid = ShapeFix_Solid().SolidFromShell(shell)
            if not solid.IsNull():
                sewn = solid
    unify = ShapeUpgrade_UnifySameDomain(sewn, True, True, True)
    unify.Build()
    fixer = ShapeFix_Shape(unify.Shape())
    fixer.Perform()
    return fixer.Shape()


def read_ifc(data: bytes) -> tuple[Shape, list[str]]:
    """(the products of an .ifc file as one compound with named parts, plain-language notes on what was skipped)."""
    ifcopenshell = _import_ifc()
    import ifcopenshell.geom

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "import.ifc")
        with open(path, "wb") as f:
            f.write(data)
        try:
            model = ifcopenshell.open(path)
        except Exception as e:
            raise ValueError("Could not read that ifc file") from e
    scale = 1000.0  # the geometry iterator always returns metres; the model works in millimetres
    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", True)
    products = [p for p in model.by_type("IfcProduct") if p.Representation is not None and not any(p.is_a(c) for c in SKIPPED_CLASSES)]
    notes = []
    for name in SKIPPED_CLASSES:
        n = len(model.by_type(name))
        if n:
            notes.append(f"Skipped {n} {name[3:].lower()} element{'s' if n != 1 else ''} (not a part)")
    parts, failed, open_shells = [], 0, 0
    for product in products:
        try:
            shape = ifcopenshell.geom.create_shape(settings, product)
            verts, faces = shape.geometry.verts, shape.geometry.faces
        except Exception:
            failed += 1
            continue
        if not len(faces):
            failed += 1
            continue
        points = [(verts[i] * scale, verts[i + 1] * scale, verts[i + 2] * scale) for i in range(0, len(verts), 3)]
        triangles = [tuple(faces[i : i + 3]) for i in range(0, len(faces), 3)]
        made = _solid_from_triangles(points, triangles)
        if made is None or made.IsNull():
            failed += 1
            continue
        cast = Shape.cast(made)
        if not cast.solids():
            open_shells += 1
        cast.label = (product.Name or product.is_a()[3:]).strip() or "Part"
        parts.append(cast)
    if failed:
        notes.append(f"Skipped {failed} product{'s' if failed != 1 else ''} without usable geometry")
    if open_shells:
        notes.append(f"{open_shells} product{'s' if open_shells != 1 else ''} did not form a closed solid and came in as surfaces")
    if not parts:
        raise ValueError("That ifc file has no products with solid geometry to import" + (f" ({'; '.join(notes)})" if notes else ""))
    compound = Compound(children=parts)
    compound.label = "ifc"
    return compound, notes


def write_ifc(shape: TopoDS_Shape, names: list[str] | None = None, linear: float = 0.005, angular: float = 0.1) -> bytes:
    """The model as an .ifc file: one IfcBuildingElementProxy per solid with a faceted B-rep body, in millimetres."""
    ifcopenshell = _import_ifc()
    import ifcopenshell.api

    run = ifcopenshell.api.run
    model = run("project.create_file", version="IFC4")
    project = run("root.create_entity", model, ifc_class="IfcProject", name="Pliable")
    run("unit.assign_unit", model, units=[run("unit.add_si_unit", model, unit_type="LENGTHUNIT", prefix="MILLI")])
    context = run("context.add_context", model, context_type="Model")
    body = run("context.add_context", model, context_type="Model", context_identifier="Body", target_view="MODEL_VIEW", parent=context)
    site = run("root.create_entity", model, ifc_class="IfcSite", name="Site")
    building = run("root.create_entity", model, ifc_class="IfcBuilding", name="Building")
    run("aggregate.assign_object", model, products=[site], relating_object=project)
    run("aggregate.assign_object", model, products=[building], relating_object=site)
    solids = Shape.cast(shape).solids() or [Shape.cast(shape)]
    for n, solid in enumerate(solids):
        vertices, triangles = solid.tessellate(linear, angular)
        points = [model.createIfcCartesianPoint((v.X, v.Y, v.Z)) for v in vertices]
        faces = []
        for a, b, c in triangles:
            loop = model.createIfcPolyLoop([points[a], points[b], points[c]])
            faces.append(model.createIfcFace([model.createIfcFaceOuterBound(loop, True)]))
        brep = model.createIfcFacetedBrep(model.createIfcClosedShell(faces))
        name = names[n] if names and n < len(names) and names[n] else f"Body {n + 1}"
        product = run("root.create_entity", model, ifc_class="IfcBuildingElementProxy", name=name)
        representation = model.createIfcShapeRepresentation(body, "Body", "Brep", [brep])
        run("geometry.assign_representation", model, product=product, representation=representation)
        run("geometry.edit_object_placement", model, product=product)
        run("spatial.assign_container", model, products=[product], relating_structure=building)
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "export.ifc")
        model.write(path)
        with open(path, "rb") as f:
            return f.read()
