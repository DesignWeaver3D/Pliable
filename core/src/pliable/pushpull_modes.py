"""Push/pull modes: which way an extrusion works (add, subtract or a new body) and how loose sketch regions are extruded.

The extrusion of a face is a tool volume. In "auto" mode a drag along the face normal adds it (fuses it with every body it
meets) and a drag against the normal subtracts it (cuts every body it meets); `flip` swaps the two. "add" always fuses,
"subtract" always cuts and "new" always adds the volume as its own separate solid, with no boolean at all.
"""

from dataclasses import dataclass

from OCP.BRep import BRep_Builder
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism
from OCP.gp import gp_Trsf, gp_Vec
from OCP.TopAbs import TopAbs_COMPOUND
from OCP.TopoDS import TopoDS_Compound, TopoDS_Iterator

from .ops import (
    MIN_DISTANCE,
    OperationError,
    OpResult,
    _boolean,
    _contains,
    _curved_prism,
    _faces_of,
    _follow,
    _volume_of,
    planar_normal,
    pull_direction,
    push_pull,
    solids_of,
    unify_result,
)

MODES = ("auto", "add", "subtract", "new")
NOTHING_TO_SUBTRACT = "Nothing to subtract: the extrusion does not reach any body"


def push_role(mode: str, flip: bool, distance: float) -> str:
    """What the extrusion of a face by the signed `distance` does: "add", "cut" or "new"."""
    if mode == "add":
        return "add"
    if mode == "subtract":
        return "cut"
    if mode == "new":
        return "new"
    return "add" if (distance > 0) != bool(flip) else "cut"


def nothing_to_subtract(shape, faces, cutters, preview: bool, message: str = NOTHING_TO_SUBTRACT) -> OpResult:
    """A subtract that removes nothing changes nothing. A commit refuses with a message; a preview keeps the model as
    it is, carries the note and still gives the cutting volumes, so the empty-space ghost can be drawn."""
    if not preview:
        raise OperationError(message)
    return OpResult(shape, list(faces), unified=True, cutters=list(cutters), notice=message)


@dataclass
class _Part:
    prism: object
    cap: object
    role: str
    tracked: bool = True  # the cap follows the pointer


def compound_of(items) -> TopoDS_Compound:
    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    for item in items:
        builder.Add(compound, item)
    return compound


def _prism(start, vector) -> tuple:
    prism = BRepPrimAPI_MakePrism(start, vector)
    prism.Build()
    if not prism.IsDone():
        raise OperationError("Could not build extrusion")
    return prism.Shape(), prism.LastShape()


def _parts(faces, distance: float, symmetric: bool, direction, mode: str, flip: bool) -> list[_Part]:
    parts = []
    for f in faces:
        normal = planar_normal(f)
        if normal is None:
            if symmetric:
                raise OperationError("Push/pull currently supports planar faces only")
            solid, moved = _curved_prism(f, distance)
            parts.append(_Part(solid, moved, push_role(mode, flip, distance)))
            continue
        pull = pull_direction(normal, direction)
        if not symmetric:
            prism, cap = _prism(f, pull.Multiplied(distance))
            parts.append(_Part(prism, cap, push_role(mode, flip, distance)))
        elif mode == "new":  # both sides additive: one body spanning the face's plane
            trsf = gp_Trsf()
            trsf.SetTranslation(gp_Vec(normal).Multiplied(-distance))
            start = BRepBuilderAPI_Transform(f, trsf, True).Shape()
            prism, cap = _prism(start, gp_Vec(normal).Multiplied(2 * distance))
            parts.append(_Part(prism, cap, "new"))
        else:  # the normal side adds and the opposite side cuts (swapped by flip); add and subtract use both sides alike
            for sign in (1, -1):
                prism, cap = _prism(f, gp_Vec(normal).Multiplied(sign * abs(distance)))
                role = push_role(mode, flip, sign)
                parts.append(_Part(prism, cap, role, tracked=(sign > 0) == (distance > 0)))
    return parts


def _follow_one(history, cap) -> list:
    """`cap` carried through one boolean's history; a face that was not an input of it stays as it is."""
    try:
        return _follow(history, [cap])
    except Exception:
        return [cap]


def push_pull_sheets(shape, faces, distance: float, symmetric: bool, direction, preview: bool, mode: str, flip: bool, keep=()) -> OpResult:
    """Push/pull on loose faces (regions of a closed sketch): each is extruded along its normal. Cutting volumes cut
    every body they meet, adding volumes are fused with the bodies they meet (or stand alone), new volumes are separate
    solids. A subtract that removes nothing changes nothing (see `nothing_to_subtract`). `keep` are faces of the bodies
    that stay tracked through the operation (the faces of a mixed selection that were already pushed or pulled)."""
    if abs(distance) < MIN_DISTANCE:
        return OpResult(shape, list(faces) + list(keep), unified=True)
    parts = _parts(faces, distance, symmetric, direction, mode, flip)
    cutters = [p.prism for p in parts if p.role == "cut"]
    adders = [p.prism for p in parts if p.role == "add"]
    news = [p.prism for p in parts if p.role == "new"]
    solids = solids_of(shape)
    others = [f for f in _faces_of(shape) if not any(f.IsSame(p) for p in faces) and not any(_contains(solid, f) for solid in solids)]
    combined, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(combined)
    histories = []
    removed = False
    if solids:
        # Booleans run on the solids alone; free faces (other sketch regions) are put back afterwards.
        body = compound_of(solids)
        if cutters:
            cut = _boolean(body, compound_of(cutters), False, glue=False)
            if cut is None:
                raise OperationError("Boolean operation failed")
            if _volume_of(cut.Shape()) < _volume_of(body) - 1e-6:
                body = cut.Shape()
                histories.append(cut)
                removed = True
        if adders:
            fuse = _boolean(body, compound_of(adders), True, glue=False)
            if fuse is None:
                raise OperationError("Boolean operation failed")
            body = fuse.Shape()
            histories.append(fuse)
        builder.Add(combined, body)
    else:
        for p in adders:
            builder.Add(combined, p)
    if cutters and not removed and not adders and not news:
        return nothing_to_subtract(shape, faces, cutters, preview)
    for p in news:
        builder.Add(combined, p)
    for f in others:
        builder.Add(combined, f)
    contributing = [p for p in parts if p.role != "cut" or removed]  # a cutter that removed nothing leaves no face to follow
    tracked = [p.cap for p in contributing if p.tracked] or [p.cap for p in contributing]
    for history in histories:
        tracked = [kept for cap in tracked for kept in _follow_one(history, cap)]
    kept_faces = list(keep)
    for history in histories:
        kept_faces = [kept for face in kept_faces for kept in _follow_one(history, face)]
    tracked = tracked + [f for f in kept_faces if _contains(combined, f)]
    result = unify_result(OpResult(combined, tracked))
    result.cutters = cutters
    return result


def align_to_first(faces, sheets):
    """Faces of a mixed selection that face the other way than the first selected face are treated as if they had its
    normal (owner ruling, 2026-10-29). A loose face is turned around; the faces of a solid cannot be, so they are
    pushed by the negated distance instead (returned as the sign). Returns (faces, sheets, solid_sign)."""
    from OCP.TopoDS import TopoDS

    reference = planar_normal(faces[0])
    if reference is None:
        return faces, sheets, 1.0
    turned, signs = [], set()
    for f in faces:
        normal = planar_normal(f)
        opposed = normal is not None and normal.IsOpposite(reference, 1e-6)
        loose = any(f.IsSame(s) for s in sheets)
        turned.append(TopoDS.Face(f.Reversed()) if opposed and loose else f)
        if not loose:
            signs.add(-1.0 if opposed else 1.0)
    if len(signs) > 1:
        raise OperationError("The faces of the body face opposite ways; select faces that face the same way")
    return turned, [f for f in turned if any(f.IsSame(s) for s in sheets)], signs.pop() if signs else 1.0


def push_pull_mixed(shape, faces, sheets, distance: float, preview: bool, follow_edges, follow_vertices, symmetric: bool, direction, mode: str, flip: bool, solid_sign: float = 1.0) -> OpResult:
    """A selection of faces of a solid together with loose sketch regions: the solid faces are pushed or pulled first, in
    the bodies alone, then the regions are extruded into the result, so the outcome is what doing each in turn gives.
    The loose faces other than the picked regions are put back untouched."""
    solid_faces = [f for f in faces if not any(f.IsSame(s) for s in sheets)]
    bodies = compound_of(solids_of(shape))
    loose = [f for f in _faces_of(shape) if not any(_contains(solid, f) for solid in solids_of(shape))]
    first = push_pull(bodies, solid_faces, distance * solid_sign, preview, follow_edges, follow_vertices, symmetric, direction, mode, flip)
    rest = compound_of([first.shape] + loose)
    second = push_pull_sheets(rest, sheets, distance, symmetric, direction, preview, mode, flip, keep=first.tracked_faces)
    second.cutters = first.cutters + second.cutters
    return second


def new_bodies(shape, faces, distance: float, symmetric: bool, direction) -> OpResult:
    """The extrusion of each face as its own new solid added beside everything else; nothing is cut or merged."""
    if abs(distance) < MIN_DISTANCE:
        return OpResult(shape, list(faces), unified=True)
    parts = _parts(faces, distance, symmetric, direction, "new", False)
    combined, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(combined)
    if shape.ShapeType() == TopAbs_COMPOUND:
        it = TopoDS_Iterator(shape)
        while it.More():
            builder.Add(combined, it.Value())
            it.Next()
    else:
        builder.Add(combined, shape)
    for p in parts:
        builder.Add(combined, p.prism)
    return unify_result(OpResult(combined, [p.cap for p in parts]))
