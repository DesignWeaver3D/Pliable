"""Closed loops of a sketch as faces: profiles, regions, offsets and the faces they sit on."""

from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge
from OCP.gp import gp_Ax2, gp_Circ, gp_Dir, gp_Elips, gp_Pnt, gp_Vec
from build123d import Edge, Face, Vector, Wire

from .errors import SketchError
from .planes import frame


MIN_LOOP_AREA = 1e-9


def _ellipse_edge(center: gp_Pnt, major: gp_Pnt, minor: float, normal):
    """A whole ellipse about `center` whose major semi-axis runs to `major` and whose minor semi-axis is `minor`."""
    radius = center.Distance(major)
    if radius < 1e-9 or minor < 1e-9:
        raise SketchError("An ellipse needs a length on both axes")
    along = gp_Vec(center, major)
    if minor > radius:  # the longer axis is perpendicular to the one clicked
        along = gp_Vec(*normal).Crossed(along)
        radius, minor = minor, radius
    return BRepBuilderAPI_MakeEdge(gp_Elips(gp_Ax2(center, gp_Dir(*normal), gp_Dir(along)), radius, minor)).Edge()


def _edges(sketch: dict, skip: int | None = None) -> list[Edge]:
    origin, x, y, normal = frame(sketch["plane"])
    points = {p["id"]: gp_Pnt(*(origin[k] + p["u"] * x[k] + p["v"] * y[k] for k in range(3))) for p in sketch.get("points", [])}
    def circle(center: gp_Pnt, radius: float) -> gp_Circ:
        return gp_Circ(gp_Ax2(center, gp_Dir(*normal), gp_Dir(*x)), radius)

    edges = []
    for e in sketch.get("entities", []):
        if e.get("construction") or e["id"] == skip:
            continue
        try:
            if e["type"] == "line":
                a, b = points[e["a"]], points[e["b"]]
                if a.Distance(b) < 1e-9:
                    raise SketchError("A line has zero length")
                shape = BRepBuilderAPI_MakeEdge(a, b).Edge()
            elif e["type"] == "circle":
                shape = BRepBuilderAPI_MakeEdge(circle(points[e["center"]], e["radius"])).Edge()
            elif e["type"] == "ellipse":
                minor = points[e["center"]].Distance(points[e["minor1"]]) if "minor1" in e else e["minor"]  # drawn with its four ends: they set the short radius
                shape = _ellipse_edge(points[e["center"]], points[e["major"]], minor, normal)
            elif e["type"] == "spline":
                through = [points[i] for i in e["points"]]
                if len(through) < 2:
                    raise SketchError("A spline needs at least two points")
                closed = bool(e.get("closed")) and len(through) > 2
                vectors = [Vector(p.X(), p.Y(), p.Z()) for p in through]
                shape = Edge.make_spline(vectors, periodic=closed).wrapped
            else:
                center, start, end = points[e["center"]], points[e["start"]], points[e["end"]]
                shape = BRepBuilderAPI_MakeEdge(circle(center, center.Distance(start)), start, end).Edge()
        except KeyError as missing:
            raise SketchError(f"Entity {e['id']} refers to a missing point {missing}") from None
        edges.append(Edge(shape))
    return edges


def profile_face(sketch: dict, skip: int | None = None) -> Face:
    """One planar face from the sketch's closed loops (construction lines and `skip` left out); loops inside
    other loops become holes. When the curves enclose areas without making closed chains of shared end points (a
    divider across a rectangle, lines attached to a side), the areas found by `regions` are joined into one face."""
    try:
        return _loops_face(sketch, skip)
    except SketchError as chains:
        if "open loop" not in str(chains):
            raise
        zones = regions(sketch, skip)
        if not zones:
            raise
        joined = zones[0] if len(zones) == 1 else zones[0].fuse(*zones[1:]).clean()
        faces = [joined] if isinstance(joined, Face) else list(joined.faces())
        if len(faces) != 1:
            raise SketchError("The sketch has several separate outlines; extrude them one at a time") from chains
        return faces[0]


def _loops_face(sketch: dict, skip: int | None = None) -> Face:
    edges = _edges(sketch, skip)
    if not edges:
        raise SketchError("The sketch has no geometry")
    wires = Wire.combine(edges)
    if not isinstance(wires, list):
        wires = [wires]
    if any(not w.is_closed for w in wires):
        raise SketchError("The sketch has an open loop: close every outline to make a profile")
    faces = sorted(((Face(w), w) for w in wires), key=lambda fw: -fw[0].area)
    if faces[-1][0].area < MIN_LOOP_AREA:
        raise SketchError("A loop in the sketch has no area")

    def inside(inner: Wire, outer: Face) -> bool:
        return outer.is_inside(inner.position_at(0.5))

    outers: list[tuple[Face, Wire]] = []
    holes: dict[int, list[Wire]] = {}
    for face, wire in faces:
        depth = sum(1 for other, _ in faces if other is not face and other.area > face.area and inside(wire, other))
        if depth % 2 == 0:
            outers.append((face, wire))
            holes[len(outers) - 1] = []
        else:
            parent = max((i for i, (of, _) in enumerate(outers) if of.area > face.area and inside(wire, of)), key=lambda i: -outers[i][0].area, default=None)
            if parent is not None:
                holes[parent].append(wire)
    if len(outers) > 1:
        raise SketchError("The sketch has several separate outlines; extrude them one at a time")
    (outer_face, outer_wire) = outers[0]
    return Face(outer_wire, holes[0]) if holes[0] else outer_face


def offset_entities(sketch: dict, entity_ids: list[int], distance: float) -> dict:
    """Parallel copies of the selected lines, arcs and circles at `distance` (positive grows a closed outline,
    negative shrinks it; for an open chain positive is to the left of its direction). Returns the new points and
    entities (fresh ids, no constraints) for the caller to add."""
    from build123d import Kind

    chosen = [e for e in sketch.get("entities", []) if e["id"] in set(entity_ids)]
    if not chosen:
        raise SketchError("Select the lines, arcs or circles to offset")
    if abs(distance) < 1e-6:
        raise SketchError("Give an offset distance")
    picked = {**sketch, "entities": [{**e, "construction": False} for e in chosen]}
    wires = Wire.combine(_edges(picked))
    wires = wires if isinstance(wires, list) else [wires]
    origin, x, y, normal = frame(sketch["plane"])
    offset_wires = []
    for wire in wires:
        try:
            result = wire.offset_2d(distance, kind=Kind.ARC)
        except Exception as e:
            raise SketchError(f"Could not offset these curves by {distance:g}") from e
        offset_wires.extend(result if isinstance(result, list) else [result])
    ids = [p["id"] for p in sketch.get("points", [])] + [e["id"] for e in sketch.get("entities", [])] + [c["id"] for c in sketch.get("constraints", [])]
    next_id = max(ids, default=0) + 1
    points: list[dict] = []
    entities: list[dict] = []

    def uv(p) -> tuple[float, float]:
        d = [p.X - origin[0], p.Y - origin[1], p.Z - origin[2]]
        return sum(a * b for a, b in zip(d, x)), sum(a * b for a, b in zip(d, y))

    def new_point(p) -> int:
        nonlocal next_id
        u, v = uv(p)
        for q in points:  # edges of one wire meet at shared points
            if abs(q["u"] - u) < 1e-7 and abs(q["v"] - v) < 1e-7:
                return q["id"]
        points.append({"id": next_id, "u": u, "v": v})
        next_id += 1
        return next_id - 1

    def new_entity(entity: dict):
        nonlocal next_id
        entities.append({"id": next_id, **entity})
        next_id += 1

    for wire in offset_wires:
        edge_list = wire.edges()
        round_edges = [e for e in edge_list if (e.geom_type.name if hasattr(e.geom_type, "name") else str(e.geom_type)) == "CIRCLE"]
        if round_edges and len(round_edges) == len(edge_list) and wire.is_closed and all(
            (e.arc_center - round_edges[0].arc_center).length < 1e-7 and abs(e.radius - round_edges[0].radius) < 1e-7 for e in round_edges
        ):  # a whole circle comes back from the offset as two half arcs
            new_entity({"type": "circle", "center": new_point(round_edges[0].arc_center), "radius": round_edges[0].radius})
            continue
        for edge in edge_list:
            kind = edge.geom_type.name if hasattr(edge.geom_type, "name") else str(edge.geom_type)
            if kind == "LINE":
                new_entity({"type": "line", "a": new_point(edge.position_at(0)), "b": new_point(edge.position_at(1))})
            elif kind == "CIRCLE":
                centre = edge.arc_center
                if edge.is_closed or (edge.position_at(0) - edge.position_at(1)).length < 1e-7:
                    new_entity({"type": "circle", "center": new_point(centre), "radius": edge.radius})
                else:
                    start, middle, end = edge.position_at(0), edge.position_at(0.5), edge.position_at(1)
                    cross = (middle - start).cross(end - middle)
                    if cross.dot(Vector(*normal)) < 0:  # arcs run counterclockwise in the sketch
                        start, end = end, start
                    new_entity({"type": "arc", "center": new_point(centre), "start": new_point(start), "end": new_point(end)})
            else:
                raise SketchError("Offsetting this kind of curve is not supported yet")
    if not entities:
        raise SketchError(f"Could not offset these curves by {distance:g}")
    return {"points": points, "entities": entities}


def _split_edges(edges: list[Edge]):
    """The edges cut into pieces wherever they cross, touch or overlap, so that pieces meet only at shared ends."""
    from OCP.BOPAlgo import BOPAlgo_Builder
    from OCP.TopAbs import TopAbs_EDGE
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS

    if len(edges) == 1:
        return [edges[0].wrapped]
    builder = BOPAlgo_Builder()
    for e in edges:
        builder.AddArgument(e.wrapped)
    builder.Perform()
    if builder.HasErrors():
        raise SketchError("Could not split the sketch into regions")
    pieces = []
    explorer = TopExp_Explorer(builder.Shape(), TopAbs_EDGE)
    while explorer.More():
        pieces.append(TopoDS.Edge(explorer.Current()))
        explorer.Next()
    return pieces


def regions(sketch: dict, skip: int | None = None) -> list[Face]:
    """Every distinct zone enclosed by the sketch's curves as a planar face. The curves are cut where they cross or
    where one ends on another (a line that ends on the side of a rectangle without sharing its corner points still
    closes a zone), so a rectangle with a divider is two faces and lines attached to a side enclose a new one. Loops
    that overlap are split where they cross, and a loop inside another cuts a hole in it (the inner zone is a face of
    its own). Curves that enclose nothing (dangling lines) make no face."""
    from OCP.BOPAlgo import BOPAlgo_BuilderFace
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace
    from OCP.collections import List_TopoDS_Shape
    from OCP.gp import gp_Ax3, gp_Dir, gp_Pln, gp_Pnt

    edges = _edges(sketch, skip)
    if not edges:
        return []
    origin, x, y, normal = frame(sketch["plane"])
    pieces = _split_edges(edges)
    # A huge flat face in the sketch plane for the builder to cut up; each piece is given in both directions so that
    # the zones on either side of it can use it.
    plane = gp_Pln(gp_Ax3(gp_Pnt(*origin), gp_Dir(*normal), gp_Dir(*x)))
    reach = 1e5
    base = BRepBuilderAPI_MakeFace(plane, -reach, reach, -reach, reach).Face()
    shapes = List_TopoDS_Shape()
    for piece in pieces:
        shapes.Append(piece)
        shapes.Append(piece.Reversed())
    builder = BOPAlgo_BuilderFace()
    builder.SetFace(base)
    builder.SetShapes(shapes)
    builder.Perform()
    if builder.HasErrors():
        raise SketchError("Could not split the sketch into regions")
    zones = []
    for found in builder.Areas():
        zone = Face(found)
        if zone.area < MIN_LOOP_AREA:
            continue
        if zone.normal_at().dot(Vector(*normal)) < 0:  # outward = along the sketch plane normal
            zone = Face(zone.wrapped.Reversed())
        zones.append(zone)
    return zones


def profile_meshes(sketch: dict) -> list[dict]:
    """The closed regions of a sketch as triangle meshes in world coordinates, for drawing them as view-only faces:
    [{"positions": [x, y, z, ...], "indices": [a, b, c, ...]}]. They are not part of any model."""
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.BRep import BRep_Tool
    from OCP.TopLoc import TopLoc_Location

    out = []
    for zone in regions(sketch):
        BRepMesh_IncrementalMesh(zone.wrapped, 0.05, False, 0.3, True)
        triangulation = BRep_Tool.Triangulation_s(zone.wrapped, TopLoc_Location())
        if triangulation is None:
            continue
        reverse = zone.wrapped.Orientation().name == "TopAbs_REVERSED"
        positions = []
        for i in range(1, triangulation.NbNodes() + 1):
            p = triangulation.Node(i)
            positions += [p.X(), p.Y(), p.Z()]
        indices = []
        for i in range(1, triangulation.NbTriangles() + 1):
            a, b, c = triangulation.Triangle(i).Get()
            indices += [a - 1, c - 1, b - 1] if reverse else [a - 1, b - 1, c - 1]
        out.append({"positions": positions, "indices": indices})
    return out


def _host_face(shape, zone: Face):
    """A planar face of `shape` that contains the zone (same plane, zone inside it), or None."""
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_Plane
    from OCP.TopAbs import TopAbs_FACE
    from OCP.TopExp import TopExp_Explorer

    point = zone.center()  # inside for convex zones; fall back to a point on the wire
    probe = point if zone.is_inside(point) else zone.outer_wire().position_at(0.5)
    zone_normal = zone.normal_at()
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        host = Face(explorer.Current())
        explorer.Next()
        surface = BRepAdaptor_Surface(host.wrapped)
        if surface.GetType() != GeomAbs_Plane:
            continue
        if abs(abs(host.normal_at().dot(zone_normal)) - 1) > 1e-6 or abs(host.distance_to(point) if False else (host.center() - point).dot(zone_normal)) > 1e-5:
            continue
        if host.is_inside(zone.outer_wire().position_at(0.25)) or host.is_inside(probe):
            # Touching only along an edge is not lying on the face (a neighbouring region of the same sketch): some area must overlap.
            common = zone.intersect(host)
            if common is not None and getattr(common, "area", 0) > 1e-6:
                return host
    return None


def add_regions(shape, sketch: dict, only: int | list[int] | None = None):
    """Put the sketch's regions into the model so they can be picked: zones lying on a flat face of the model
    are imprinted on it (the face is split along their outline), the others are added as free faces. `only` picks
    one region, or several, by their index in `regions` (the order `profile_meshes` draws them in). Returns the new shape and how
    many regions became faces."""
    from OCP.BRep import BRep_Builder
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Splitter
    from OCP.collections import List_TopoDS_Shape
    from OCP.TopoDS import TopoDS_Compound

    zones = regions(sketch)
    if not zones:
        raise SketchError("The sketch has no closed outline to make a face from")
    if only is not None:
        wanted = [only] if isinstance(only, int) else list(only)
        if not wanted or any(not 0 <= i < len(zones) for i in wanted):
            raise SketchError("That region of the sketch no longer exists")
        zones = [zones[i] for i in dict.fromkeys(wanted)]
    imprint, loose = [], []
    for zone in zones:
        (imprint if _host_face(shape, zone) is not None else loose).append(zone)
    result = shape
    if imprint:
        splitter = BRepAlgoAPI_Splitter()
        arguments, tools = List_TopoDS_Shape(), List_TopoDS_Shape()
        arguments.Append(shape)
        for zone in imprint:
            tools.Append(zone.wrapped)
        splitter.SetArguments(arguments)
        splitter.SetTools(tools)
        splitter.SetNonDestructive(True)
        splitter.Build()
        if splitter.IsDone() and not splitter.Shape().IsNull():
            result = splitter.Shape()
        else:
            loose.extend(imprint)
    if loose:
        compound, builder = TopoDS_Compound(), BRep_Builder()
        builder.MakeCompound(compound)
        if not result.IsNull():  # a blank document's shape is a null compound; adding it would crash
            builder.Add(compound, result)
        for zone in loose:
            builder.Add(compound, zone.wrapped)
        result = compound
    return result, len(zones)


def region_face(shape, sketch: dict, index: int):
    """The face of `shape` (the result of `add_regions` with `only=index`) that is the sketch's region `index`: the
    flat face in the region's plane with its area and centre, or None."""
    from OCP.TopAbs import TopAbs_FACE
    from OCP.TopExp import TopExp_Explorer

    zone = regions(sketch)[index]
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        candidate = Face(explorer.Current())
        explorer.Next()
        if abs(candidate.area - zone.area) > 1e-6 * max(1.0, zone.area):
            continue
        if (candidate.center() - zone.center()).length < 1e-5 and abs(candidate.normal_at().dot(zone.normal_at())) > 1 - 1e-6:
            return candidate.wrapped
    return None
