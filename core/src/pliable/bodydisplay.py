"""Display data kept per body, so a reply rebuilds only the bodies that changed.

`tessellate` walks every face, edge and vertex of the model on each reply; for a model of many bodies that is seconds of
Python even when one body changed. Here the display data of a body (triangles, edge lines, the per-face and per-edge
records with numbers counted from the body's own first one) is kept under a key made of the triangulation, location and
orientation of every face of the body, its face, edge and vertex counts, the deflection and whether it is a preview.
The body's shape cannot be the key: every operation ends by copying the whole model's topology (facemerge.py), so no
body keeps its shape, only the triangulations and geometry its faces share with the old one. A face that an edit
changes loses its triangulation, so a body with every triangulation as stored has the faces it had; its vertices are
read again on every call, which is cheap. Any other change rebuilds the body.

Ids are positions in the whole model's indexed maps. They are contiguous per body only when no face, edge or vertex
is shared between bodies or held by a shape outside the bodies; `body_ranges` checks that and answers None otherwise
(the caller then takes the whole-model path, which looks every id up).
"""

from dataclasses import dataclass, replace
from itertools import count as count_from

import numpy as np
from OCP.BRep import BRep_Tool
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_VERTEX
from OCP.TopExp import TopExp, TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS
from OCP.collections import IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher as IndexedMap

from . import meshing, recipes
from .meshread import MeshReader
from .ops import is_surface
from .splitwalls import split_centre

_KINDS = (TopAbs_FACE, TopAbs_EDGE, TopAbs_VERTEX)
_revs = count_from(1)


def _stamped(data):
    data.rev = next(_revs)
    return data


@dataclass
class BodyData:
    """Display data of one body; face, edge and vertex numbers are local (0-based within the body)."""

    positions: np.ndarray
    normals: np.ndarray
    indices: np.ndarray  # uint32, local to this body's positions
    edge_positions: np.ndarray
    faces: list  # (start, count, normal or None, centroid or None), start local to `indices`
    centres: list  # (local face number, position, axis, length)
    edges: list  # (start, count, normal or None, centre or None), start local to `edge_positions`
    bounds: list
    weight: int
    full_rev: int = 0  # for a preview made from the full display: that display's rev (a page holding it holds all a preview shows)
    rev: int = 0  # set when the data is built or derived; a cache hit keeps it, so equal revs mean the very same display data


def _own_extents(solid) -> tuple[int, int, int]:
    out = []
    for kind in _KINDS:
        indexed = IndexedMap()
        TopExp.MapShapes_s(solid, kind, indexed)
        out.append(indexed.Extent())
    return tuple(out)


def body_ranges(topology, solid_shapes) -> list | None:
    """(first face id, face count, first edge id, edge count, first vertex id, vertex count) of each body, or None when
    the ids of a body are not one block: the bodies' own counts must add up to the model's, so nothing is shared
    between bodies or with a shape outside them."""
    if not solid_shapes:
        return None
    counts = [_own_extents(solid) for solid in solid_shapes]
    totals = tuple(sum(c[k] for c in counts) for k in range(3))
    if totals != (topology.face_count, topology.edge_count, topology.vertex_count):
        return None
    out, first = [], [0, 0, 0]
    for count in counts:
        out.append((first[0], count[0], first[1], count[1], first[2], count[2]))
        first = [first[k] + count[k] for k in range(3)]
    return out


def _key_parts(solid) -> tuple:
    """The triangulation, location and orientation of every face of the body: what the key of its display data is made of."""
    triangulations, locations, orientations = [], [], []
    explorer = TopExp_Explorer(solid, TopAbs_FACE)
    while explorer.More():
        face = TopoDS.Face(explorer.Current())
        location = TopLoc_Location()
        triangulations.append(BRep_Tool.Triangulation_s(face, location))
        locations.append(location)
        orientations.append(face.Orientation())
        explorer.Next()
    return tuple(triangulations), tuple(locations), tuple(orientations)


def _make_key(parts: tuple, span, deflection: float, preview: bool):
    """The key of a body's display data (see the top of this file)."""
    from .tessellate import _MeshKey

    triangulations, locations, orientations = parts
    counts = (span[1], span[3], span[5])
    return _MeshKey(triangulations, locations, "b", deflection, preview, counts, orientations)


def _body_key(solid, span, deflection: float, preview: bool):
    return _make_key(_key_parts(solid), span, deflection, preview)


def _cat(parts: list, dtype, width: int | None) -> np.ndarray:
    if not parts:
        return np.empty(0 if width is None else (0, width), dtype=dtype)
    return np.concatenate(parts).astype(dtype, copy=False)


def _edges_beside(topology, face_shapes: list) -> dict:
    """The local faces next to each edge (by edge id), in face order."""
    table: dict[int, list[int]] = {}
    for local, face in enumerate(face_shapes):
        explorer = TopExp_Explorer(face, TopAbs_EDGE)
        while explorer.More():
            found = topology.edge_id(explorer.Current())
            if found is not None:
                held = table.setdefault(found, [])
                if not held or held[-1] != local:  # a seam edge shows twice in its face
                    held.append(local)
            explorer.Next()
    return table


def _build(topology, solid, span, deflection: float, preview: bool) -> BodyData:
    """The per-face, per-edge and per-vertex work of `tessellate`, for one body."""
    from . import tessellate as T

    f0, nf, e0, ne, _, _ = span
    meshing.mesh(solid, deflection, T.ANGULAR_DEFLECTION)
    reader = MeshReader(solid)
    positions, normals, indices, faces, centres = [], [], [], [], []
    face_shapes, face_positions = [], []
    base = count = 0
    for local in range(nf):
        face = topology.face(f0 + local)
        data, normal, centre = T._face_display(face, reader)
        face_shapes.append(face)
        face_positions.append(None if data is None else data[0])
        if centre is None:
            centre = split_centre(topology, f0 + local)
        start, centroid = count, None
        if data is not None:
            pos, nrm, idx, centroid = data
            positions.append(pos)
            normals.append(nrm)
            indices.append(idx + np.uint32(base))
            base += len(pos)
            count += idx.size
        if centre is not None:
            centres.append((local, list(centre[0]), list(centre[1]), centre[2]))
        faces.append((start, count - start, None if normal is None else list(normal), centroid))

    table = _edges_beside(topology, face_shapes)
    edge_parts, edges, total = [], [], 0
    for local in range(ne):
        edge = topology.edge(e0 + local)
        beside = table.get(e0 + local, [])
        points = T._edge_points(edge, deflection, lambda beside=beside: [(face_shapes[f], face_positions[f]) for f in beside])
        edge_parts.append(points)
        normal = None if preview else T._edge_normal(edge, [face_shapes[f] for f in beside])
        edges.append((total, len(points), normal, T._edge_centre(edge)))
        total += len(points)

    edge_positions = _cat(edge_parts, np.float32, 3)
    return _stamped(BodyData(
        _cat(positions, np.float32, 3),
        _cat(normals, np.float32, 3),
        _cat(indices, np.uint32, None),
        edge_positions,
        faces,
        centres,
        edges,
        T.bounds(solid),
        1 + sum(i.size for i in indices) // 3 + len(edge_positions) // 2,
    ))


def _preview_of(full: BodyData) -> BodyData:
    """The data of a preview from that of the full display: the same, without the edges' drag directions."""
    return _stamped(replace(full, edges=[(start, count, None, centre) for start, count, _, centre in full.edges], full_rev=full.rev))


def _with_normals(topology, solid, span, preview_data: BodyData) -> BodyData:
    """The full display data from that of a preview: the same, with the edges' drag directions added."""
    from . import tessellate as T

    f0, nf, e0, ne, _, _ = span
    face_shapes = [topology.face(f0 + local) for local in range(nf)]
    table = _edges_beside(topology, face_shapes)
    edges = []
    for local, (start, count, _, centre) in enumerate(preview_data.edges):
        beside = [face_shapes[f] for f in table.get(e0 + local, [])]
        edges.append((start, count, T._edge_normal(topology.edge(e0 + local), beside), centre))
    return _stamped(replace(preview_data, edges=edges, full_rev=0))


def body_data(topology, solid, span, deflection: float, preview: bool) -> BodyData:
    """The body's display data: from the cache when its shape, deflection and every face's triangulation are as stored.
    A preview and the full display of a body differ only in the edges' drag directions, so one is made from the other when
    only the other is stored."""
    from .tessellate import body_cache

    parts = _key_parts(solid)
    key = _make_key(parts, span, deflection, preview)
    entry = body_cache.get(key)
    if entry is not None:
        return entry
    other = body_cache.entries.get(_make_key(parts, span, deflection, not preview))
    if other is not None:
        entry = _preview_of(other[0]) if preview else _with_normals(topology, solid, span, other[0])
        body_cache.put(key, entry, entry.weight)
        return entry
    entry = _build(topology, solid, span, deflection, preview)  # meshes the faces that need it, so the key is made again
    body_cache.put(_body_key(solid, span, deflection, preview), entry, entry.weight)
    return entry


@dataclass
class BodyPart:
    """One body of the model as the reply lists it: its display data, the block of ids it owns and its records that are not kept in the data."""

    number: int  # position among the solids
    body: int | None  # the body's id
    span: tuple  # (first face id, face count, first edge id, edge count, first vertex id, vertex count)
    data: BodyData
    vertices: list  # the body's vertices, with global ids
    info: dict | None  # the entry of the reply's `bodies` list


def body_parts(topology, preview: bool, ranges: list, solid_shapes: list, deflection: float) -> list[BodyPart]:
    """The bodies of the model one by one, in model order (the parts `assemble` joins; a delta reply sends only some of them)."""
    owners = topology.bodies.bodies
    parts = []
    for number, (solid, span) in enumerate(zip(solid_shapes, ranges)):
        data = body_data(topology, solid, span, deflection, preview)
        v0, nv = span[4], span[5]
        owner = owners[number] if number < len(owners) else None
        body = owner.id if owner is not None else None
        vertices = []
        for i in range(nv):
            p = BRep_Tool.Pnt_s(topology.vertex(v0 + i))
            vertices.append({"id": v0 + i, "position": [p.X(), p.Y(), p.Z()], "solid": number, "body": body})
        info = None
        if owner is not None:
            info = {"id": owner.id, "name": owner.name, "solid": number, "bounds": list(data.bounds), "material": owner.material, "locked": owner.locked, "surface": is_surface(solid), **recipes.info(owner)}
        parts.append(BodyPart(number, body, span, data, vertices, info))
    return parts


def assemble(topology, preview: bool, ranges: list, solid_shapes: list, deflection: float, parts: list | None = None) -> dict:
    """The fields of a Mesh for the whole model, joined from the bodies' data (the order and ids `tessellate` gives).
    `parts` are the bodies from `body_parts` when the caller has them already."""
    from .tessellate import _join

    positions, normals, indices, edge_parts = [], [], [], []
    faces, edges, vertices, centres, body_info = [], [], [], [], []
    base = index_count = edge_total = 0
    for part in parts if parts is not None else body_parts(topology, preview, ranges, solid_shapes, deflection):
        data, number, body = part.data, part.number, part.body
        f0, _, e0 = part.span[:3]
        positions.append(data.positions)
        normals.append(data.normals)
        indices.append(data.indices + np.uint32(base))
        edge_parts.append(data.edge_positions)
        faces.extend(
            {"id": f0 + i, "start": index_count + start, "count": count, "normal": None if normal is None else list(normal), "centroid": centroid, "solid": number, "body": body}
            for i, (start, count, normal, centroid) in enumerate(data.faces)
        )
        centres.extend({"face": f0 + local, "position": list(pos), "axis": list(axis), "length": length} for local, pos, axis, length in data.centres)
        edges.extend(
            {"id": e0 + i, "start": edge_total + start, "count": count, "normal": None if normal is None else list(normal), "solid": number, "body": body, "centre": None if centre is None else list(centre)}
            for i, (start, count, normal, centre) in enumerate(data.edges)
        )
        vertices.extend(part.vertices)
        if part.info is not None:
            body_info.append(part.info)
        base += len(data.positions)
        index_count += data.indices.size
        edge_total += len(data.edge_positions)
    return {
        "positions": _join(positions, np.float32, (-1, 3)),
        "normals": _join(normals, np.float32, (-1, 3)),
        "indices": _join(indices, np.uint32, (-1,)),
        "edge_positions": _join(edge_parts, np.float32, (-1, 3)),
        "faces": faces,
        "edges": edges,
        "vertices": vertices,
        "centres": centres,
        "bodies": body_info,
    }
