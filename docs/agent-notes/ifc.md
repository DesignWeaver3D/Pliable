# IFC and 3dm export notes (ifc agent)

## Task 1: .ifc (built)
- core/src/pliable/filesifc.py; hooked into files.py (read_step_tree / write_cad) and server.py (export passes body names).
- Optional extra `ifc` in core/pyproject.toml, also in the dev group so tests run; imported lazily, a clear message when missing (installed size about 120 MB).
- Import uses the geometry iterator (triangles, metres), not its OCC bindings. Triangles are sewn, closed shells become solids, coplanar faces are merged. Skips and open shells are reported as import warnings.
- Export: IFC4, IfcBuildingElementProxy per solid, IfcFacetedBrep (0.005 mm, 0.1 rad), millimetres, named after the body. Curved faces stay faceted (exact B-rep needs the bindings).
- Checked: pytest (572 pass), npm tests, tsc, build; in Chrome on 5202/8802 exported bracket.ifc (479 KB) from the Export CAD list and imported it back (2 bodies, 687 faces).

## Task 2: true .3dm export (no route)
rhino3dm 8.35 Brep exposes only CreateFromSurface, CreateTrimmedPlane, primitives, Faces/Edges/Surfaces readers; no AddEdge, AddTrim, AddLoop, AddFace or Join. A general trimmed B-rep cannot be built. Triangle-mesh export stays.
