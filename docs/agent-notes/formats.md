# More import and export file types: status and findings

## Done
- STEP (.step, .stp), compressed STEP (.stpZ, gzip), IGES (.iges, .igs), BREP (.brep, .brp): already built in commit f084d4b (OCP 8.0.1 reads and writes them itself). This session added volume comparisons to the round-trip tests (`core/tests/test_cad_formats.py`) and recorded the extensions in `docs/behavior.md`.
- .3dm: built (see below).

## .ifc: not built
- OCCT has no IFC reader or writer. The usual route is IfcOpenShell (LGPL-3.0-or-later; PyPI wheels about 42 to 55 MB per platform for 0.9.0). Feasible (it yields OCC shapes through its geometry iterator), but it is a large dependency for the packaged build and IFC is a building-model format with property sets Pliable cannot keep. Left as a documented finding; needs the owner's approval of the dependency.

## .3dm: built through rhino3dm
- Library: rhino3dm 8.35.0 (Python wheels of openNURBS), MIT licence; wheels for Windows (2.4 MB), macOS (universal2, 5.3 MB), Linux x86_64 and aarch64 (5 MB), cp39 to cp314. Meets the small, permissive, three-platform bar.
- Import (`core/src/pliable/files3dm.py`): each Brep (and extrusion) is converted face by face: 3dm NURBS surface to a kernel B-spline surface, each trim's 3D edge to a B-spline edge, wires built from the loops, faces repaired with ShapeFix, then sewn (1e-3 mm) and sent through the normal import healing, which turns closed shells into solids. Whole-patch faces (full sphere, torus-like seams, poles) use natural bounds. Tested with a box, cylinder and sphere. Limits: faces with several loops and poles are untested; meshes, curves and point clouds in the file are skipped; layers, colours and names are not read.
- Export: the wheels cannot build trimmed B-reps (only primitives and untrimmed surfaces), so .3dm is written as one triangle mesh per solid (0.01 mm / 0.3 rad), like STL. It is labelled lossy in the list. A true B-rep export would need the file written another way (not available in the wheels).
- A whole NURBS sphere reports a volume about 1% off because the kernel integrates its pole singularities roughly; the geometry itself is exact.

## Chrome check
See the end of this file.
