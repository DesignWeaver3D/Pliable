# Exact B-rep export for .ifc and .3dm (notes)

## .ifc (built)
- IfcOpenShell 0.9.0.post1 wheels are `py310-none` per platform (macOS x86_64 and arm64, manylinux aarch64 and x86_64, Windows); they work on Python 3.13. They carry NO Python OCC bindings (`ifcopenshell.geom.has_occ` is False), so there is no route from an OCP shape through the IFC library itself.
- Built instead: `core/src/pliable/filesifcexact.py` writes IfcAdvancedBrep ourselves from OCP data with the IFC library already in use (no new dependency). Analytic planes, cylinders, spheres, tori; lines, circles, ellipses; everything else becomes a B-spline (rational where the weights differ; periodic ones cut open so knots are clamped). IFC4 has no cone: cones are written as a rational B-spline of four quarter arcs (the kernel's own 3-arc conversion is meshed wrongly by the IFC reader: bulged cones).
- Fallback to the faceted body per solid when the exact writer raises: faces with a degenerate edge (poles, e.g. a full sphere; the reader drops such a face), solids with more than one shell.
- Import: the reader meshes at 0.1 mm / 0.05 rad now (was the library default) so exact bodies sew back into matching volumes. This makes the test file slower (about 50 s) and curved imports have more triangles.
- Checked by reading the files back through the IFC geometry iterator at a fine deflection: signed volume matches the kernel volume within 0.2 percent for box, cylinder, filleted bracket with a hole, cone (both directions), torus, loft, revolved profile, extruded spline; the sign is positive so the faces point outward.
- Import of an exact IFC body still goes through triangles (the reader sews meshes); exact import is not part of this row.
