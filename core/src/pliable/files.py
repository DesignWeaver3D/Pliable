"""STEP import and export."""

import os
import tempfile

from build123d import Mesher, export_step, export_stl, import_step
from build123d.topology import Shape
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.BRep import BRep_Tool
from OCP.BRepBuilderAPI import BRepBuilderAPI_FindPlane, BRepBuilderAPI_Sewing
from OCP.BRepTools import BRepTools_ReShape
from OCP.ShapeAnalysis import ShapeAnalysis_FreeBounds
from OCP.ShapeFix import ShapeFix_Shell, ShapeFix_Solid
from OCP.TopAbs import TopAbs_SHELL, TopAbs_WIRE, TopAbs_SOLID as TopAbs_SOLID_
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS, TopoDS_Compound, TopoDS_Shape

from .ops import solids_of

SEWING_TOLERANCE = 1e-3  # model units (mm): gaps up to this size between surface edges are stitched shut


def read_step_tree(data: bytes):
    """The imported assembly as a build123d tree, which keeps the part names."""
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "import.step")
        with open(path, "wb") as f:
            f.write(data)
        return import_step(path)


def read_step(data: bytes) -> TopoDS_Shape:
    return read_step_tree(data).wrapped


GENERIC_LABELS = {"COMPOUND", "SOLID", "SHELL", "Part", "Unknown"}  # what the reader calls parts the file did not name


def part_names(root) -> list[tuple[TopoDS_Shape, str]]:
    """(solid, part name) for every solid of an imported tree whose part has a name; deeper parts win, and a part with
    several solids numbers them."""
    named: list[tuple[TopoDS_Shape, str]] = []
    for leaf in [root, *root.descendants]:
        label = (getattr(leaf, "label", "") or "").strip()
        solids = solids_of(leaf.wrapped)
        if not label or label in GENERIC_LABELS or not solids:
            continue
        for n, solid in enumerate(solids):
            named = [(s, t) for s, t in named if not s.IsPartner(solid)]
            named.append((solid, label if len(solids) == 1 else f"{label} {n + 1}"))
    return named


def read_step_checked(data: bytes) -> tuple[TopoDS_Shape, list[str]]:
    """Import, heal and report: the shape plus plain-language warnings."""
    shape, warnings, _ = read_step_parts(data)
    return shape, warnings


def read_step_parts(data: bytes) -> tuple[TopoDS_Shape, list[str], list[tuple[TopoDS_Shape, str]]]:
    """Like read_step_checked, plus the (solid, part name) pairs of the file's named parts."""
    root = read_step_tree(data)
    names = []  # (shell, part name) for every surface body outside a solid
    for leaf in [root, *root.descendants]:
        for shell in _loose_shells(leaf.wrapped):
            names.append((shell, getattr(leaf, "label", "") or "unnamed"))
    shape, warnings = check_import(root.wrapped, names)
    return shape, warnings, part_names(root)


def write_step(shape: TopoDS_Shape) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "export.step")
        export_step(Shape.cast(shape), path)
        with open(path, "rb") as f:
            return f.read()


MESH_FORMATS = ("stl", "obj", "3mf")
# The slicer's own defaults for importing a STEP file (its STEP mesh dialog and app config): linear deflection 0.003 mm,
# angular deflection 0.5 radian, both absolute (see docs/decisions-log.md). Its dialog accepts 0.001 to 0.1 mm and 0.01 to 1.0 rad.
MESH_LINEAR_DEFLECTION = 0.003
MESH_ANGULAR_DEFLECTION = 0.5
LINEAR_RANGE = (0.0001, 10.0)
ANGULAR_RANGE = (0.01, 1.5)


def write_mesh(shape: TopoDS_Shape, fmt: str, linear: float = MESH_LINEAR_DEFLECTION, angular: float = MESH_ANGULAR_DEFLECTION) -> bytes:
    """Triangle-mesh export (STL, OBJ, 3MF). Lossy compared with STEP: curved faces become triangles.
    `linear` is the largest distance (model units) between the surface and its triangles; `angular` the largest angle (radians) between neighbouring triangles' normals.
    The export meshes a copy of the shape, so what is drawn in the view is not affected."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy

    if fmt not in MESH_FORMATS:
        raise ValueError(f"Unknown mesh format {fmt!r}")
    if not LINEAR_RANGE[0] <= linear <= LINEAR_RANGE[1]:
        raise ValueError(f"The linear deflection must be between {LINEAR_RANGE[0]} and {LINEAR_RANGE[1]}")
    if not ANGULAR_RANGE[0] <= angular <= ANGULAR_RANGE[1]:
        raise ValueError(f"The angular deflection must be between {ANGULAR_RANGE[0]} and {ANGULAR_RANGE[1]} radians")
    solid = Shape.cast(BRepBuilderAPI_Copy(shape, True).Shape())
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, f"export.{fmt}")
        if fmt == "stl":
            export_stl(solid, path, tolerance=linear, angular_tolerance=angular)
        elif fmt == "3mf":
            mesher = Mesher()
            mesher.add_shape(solid, linear_deflection=linear, angular_deflection=angular)
            mesher.write(path)
        else:
            vertices, triangles = solid.tessellate(linear, angular)
            with open(path, "w") as f:
                f.write("# Pliable export" + chr(10))
                for v in vertices:
                    f.write(f"v {v.X:.6f} {v.Y:.6f} {v.Z:.6f}" + chr(10))
                for a, b, c in triangles:
                    f.write(f"f {a + 1} {b + 1} {c + 1}" + chr(10))
        with open(path, "rb") as f:
            return f.read()


def _volume(shape: TopoDS_Shape) -> float:
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return props.Mass()


def _loose_shells(shape: TopoDS_Shape) -> list[TopoDS_Shape]:
    """Shells (surface bodies) that are not part of any solid."""
    explorer = TopExp_Explorer(shape, TopAbs_SHELL, TopAbs_SOLID_)
    shells = []
    while explorer.More():
        shells.append(explorer.Current())
        explorer.Next()
    return shells


def _close_shell(shell: TopoDS_Shape) -> TopoDS_Shape | None:
    """A solid made from a surface body, or None if it can't be closed.

    Tries the body as is, then OpenCASCADE's shell fixer, then sewing nearly touching edges.
    """
    for attempt in (lambda: shell, lambda: _fix_shell(shell), lambda: _sew(shell)):
        candidate = attempt()
        if candidate is None or not BRep_Tool.IsClosed_s(candidate):
            continue
        solid = ShapeFix_Solid().SolidFromShell(TopoDS.Shell(candidate))
        if not solid.IsNull() and _volume(solid) > 0 and BRepCheck_Analyzer(solid).IsValid():
            return solid
    return None


def _fix_shell(shell: TopoDS_Shape) -> TopoDS_Shape | None:
    fixer = ShapeFix_Shell(TopoDS.Shell(shell))
    fixer.Perform()
    return fixer.Shell()


def _sew(shell: TopoDS_Shape) -> TopoDS_Shape | None:
    sewing = BRepBuilderAPI_Sewing(SEWING_TOLERANCE)
    sewing.Add(shell)
    sewing.Perform()
    result = sewing.SewedShape()
    explorer = TopExp_Explorer(result, TopAbs_SHELL)
    return explorer.Current() if explorer.More() else None


def open_loops(shell: TopoDS_Shape) -> list[bool]:
    """One entry per open boundary loop of a surface body: True if the loop is flat.

    Flat loops can be capped, so this tells us whether capping holes alone would
    close a body that import could not.
    """
    try:
        bounds = ShapeAnalysis_FreeBounds(shell, SEWING_TOLERANCE, False, False)
        closed = bounds.GetClosedWires()
        flags = []
        explorer = TopExp_Explorer(closed, TopAbs_WIRE)
        while explorer.More():
            finder = BRepBuilderAPI_FindPlane(explorer.Current(), SEWING_TOLERANCE)
            flags.append(finder.Found())
            explorer.Next()
        return flags
    except Exception:
        return []


def _open_body_line(name: str, loops: list[bool]) -> str:
    if not loops:
        return f"Open body '{name}': boundary loops could not be analysed"
    flat = sum(loops)
    return f"Open body '{name}': {len(loops)} open loop{'s' if len(loops) != 1 else ''}, {flat} flat"


def _name_list(names: list[str]) -> str:
    shown = ", ".join(names[:5])
    return shown + (f" and {len(names) - 5} more" if len(names) > 5 else "")


def check_import(shape: TopoDS_Shape, names: list | None = None) -> tuple[TopoDS_Shape, list[str]]:
    """Heal an imported shape and report what could not be fixed.

    Surface bodies that close up become solids and inside-out solids are turned right
    way round. `names` pairs shells with part names so warnings can say which parts to
    look at in another CAD program. Returns the shape and plain-language warnings.
    """
    names = names or []

    def label(shell) -> str:
        return next((n for s, n in names if s.IsPartner(shell)), "unnamed")

    reshape = BRepTools_ReShape()
    converted, open_names, open_lines = 0, [], []
    for shell in _loose_shells(shape):
        solid = _close_shell(shell)
        if solid is None:
            open_names.append(label(shell))
            open_lines.append(_open_body_line(open_names[-1], open_loops(shell)))
        else:
            reshape.Replace(shell, solid)
            converted += 1
    if converted:
        shape = reshape.Apply(shape)

    fixed = invalid = 0
    reshape = BRepTools_ReShape()
    for solid in solids_of(shape):
        if _volume(solid) < 0:
            fixer = ShapeFix_Solid(TopoDS.Solid(solid))
            fixer.Perform()
            if _volume(fixer.Solid()) > 0:
                reshape.Replace(solid, fixer.Solid())
                fixed += 1
        if not BRepCheck_Analyzer(solid).IsValid():
            invalid += 1
    if fixed:
        shape = reshape.Apply(shape)

    warnings = []
    if converted:
        warnings.append(f"{converted} surface bod{'ies' if converted != 1 else 'y'} closed and made into solids")
    if fixed:
        warnings.append(f"{fixed} inside-out solid{'s' if fixed != 1 else ''} repaired")
    if invalid:
        warnings.append(f"{invalid} solid{'s' if invalid != 1 else ''} with invalid geometry; some tools may fail there")
    if open_names:
        warnings.append(f"{len(open_names)} open surface{'s' if len(open_names) != 1 else ''} could not be closed ({_name_list(open_names)}); tools can't add material there")
        warnings.extend(open_lines)
    return shape, warnings
