"""Editable primitives: the recipe a body keeps while it is still the shape the primitive tool made.

A recipe is a plain dict stored on the body record (bodies.Body.recipe), so it travels with undo, redo and autosave:

    {"tool": "add_box", "params": {...}, "m": [12 floats], "sig": {...}}

`params` are the tool's own values (size and base point), `m` is the placement transform applied after the primitive is
built (the identity until the body is rotated), and `sig` is a signature of the shape: volume, face count and bounding
box. After every commit `settle` keeps a recipe only while the body's shape still matches its signature; a fillet, cut,
push/pull, boolean or non-uniform scale changes the shape, so the recipe is dropped and the body records why
(`Body.lost`, shown as "Changed by Fillet/Chamfer"). Moves, rotations and uniform scales are followed: they update `params`
and `m`, and the result is checked against the real shape before the recipe is kept. A primitive combined with another
solid becomes an ordinary solid (no hidden record is kept).
"""

import math
from dataclasses import replace

from OCP.BRepBndLib import BRepBndLib
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.Bnd import Bnd_Box
from OCP.TopAbs import TopAbs_FACE
from OCP.TopExp import TopExp
from OCP.collections import IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher
from OCP.TopoDS import TopoDS_Shape
from OCP.gp import gp_Pnt, gp_Trsf

from .bodies import Body, BodyState, _volume
from .ops import solids_of

IDENTITY = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0]
PLACEMENT = ("x", "y", "z")
NOT_PRIMITIVE = "Not a primitive (it was imported or made by another tool)"


def signature(solid: TopoDS_Shape) -> dict:
    faces = IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher()
    TopExp.MapShapes_s(solid, TopAbs_FACE, faces)
    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(solid, box, False, False)
    lo, hi = box.CornerMin(), box.CornerMax()
    return {"v": _volume(solid), "f": faces.Size(), "b": [lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()]}


def same_signature(a: dict, b: dict) -> bool:
    if a["f"] != b["f"] or abs(a["v"] - b["v"]) > 1e-6 * max(abs(a["v"]), 1.0):
        return False
    diag = max(max(a["b"][k + 3] - a["b"][k] for k in range(3)), 1.0)
    return all(abs(x - y) <= 1e-5 * diag for x, y in zip(a["b"], b["b"]))


def trsf_list(t: gp_Trsf) -> list[float]:
    return [t.Value(r, c) for r in (1, 2, 3) for c in (1, 2, 3, 4)]


def list_trsf(m: list[float]) -> gp_Trsf:
    t = gp_Trsf()
    if not _is_identity(m):
        t.SetValues(*m)
    return t


def _is_identity(m: list[float]) -> bool:
    return all(abs(a - b) <= 1e-12 for a, b in zip(m, IDENTITY))


def _rotation_free(m: list[float]) -> bool:
    """True when the matrix part of `m` is the identity (it only translates)."""
    return all(abs(m[r * 4 + c] - (1.0 if r == c else 0.0)) <= 1e-9 for r in range(3) for c in range(3))


def is_placed(recipe: dict) -> bool:
    """True when the primitive is rotated (its handles for position are then not offered)."""
    return not _rotation_free(recipe["m"])


def build(recipe: dict) -> TopoDS_Shape:
    """The solid the recipe describes."""
    from .tools import get_tool

    tool = get_tool(recipe["tool"])
    solid = tool.make(tool.bind(recipe["params"]))
    m = list_trsf(recipe["m"])
    return solid if _is_identity(recipe["m"]) else BRepBuilderAPI_Transform(solid, m, True).Shape()


def make(tool_id: str, params: dict, solid: TopoDS_Shape, m: list[float] | None = None) -> dict:
    return {"tool": tool_id, "params": {k: float(v) for k, v in params.items()}, "m": list(m or IDENTITY), "sig": signature(solid)}


def followed(recipe: dict, t: gp_Trsf) -> dict:
    """The recipe after the body was transformed by `t` (a move, rotation or uniform scale)."""
    params = dict(recipe["params"])
    m = list_trsf(recipe["m"])
    s = t.ScaleFactor()
    if abs(s - 1.0) > 1e-9:
        # Scaling about the origin of the primitive's own frame is the same primitive with every length times s;
        # what is left of the transform is a rigid placement.
        for key in params:
            if key != "new_body":
                params[key] *= s
        about = gp_Trsf()
        about.SetScale(gp_Pnt(0, 0, 0), s)
        m = t.Multiplied(m).Multiplied(about.Inverted())
    else:
        m = t.Multiplied(m)
    placed = trsf_list(m)
    if _rotation_free(placed):  # only a translation: fold it into the base point so the form shows the new position
        for k, key in enumerate(PLACEMENT):
            params[key] = params.get(key, 0.0) + placed[k * 4 + 3]
        placed = list(IDENTITY)
    return {**recipe, "params": params, "m": placed}


def reason(body: Body) -> str | None:
    """Why the body cannot be edited as a primitive, or None when it can."""
    if body.recipe is not None:
        return None
    return f"Changed by {body.lost}" if body.lost else NOT_PRIMITIVE


def settle(prev: BodyState, state: BodyState, shape: TopoDS_Shape, cause: str, combined: set[int] | str | None = None,
           moved: dict | None = None, assign: dict | None = None) -> BodyState:
    """The bodies of a new document state with their recipes brought up to date.

    `prev` and `state` are the bodies before the operation and after matching them to the new solids; `cause` names the
    operation for the "Changed by ..." reason; `combined` lists body ids (or "all") the operation combined with another
    solid; `moved` maps body ids to the transform applied to them; `assign` maps a body id (None for the one new body)
    to the recipe it now has (a new or an edited primitive)."""
    if not any(b.recipe for b in state.bodies) and not assign:
        return state
    solids = solids_of(shape)
    known = {b.id for b in prev.bodies}
    out = []
    for index, body in enumerate(state.bodies):
        recipe = body.recipe
        if recipe is not None and index < len(solids):
            solid = solids[index]
            try:
                if combined == "all" or (combined and body.id in combined):
                    recipe = None
                elif moved and body.id in moved:
                    recipe = followed(recipe, moved[body.id])
                    if not same_signature(signature(build(recipe)), signature(solid)):
                        recipe = None
                    else:
                        recipe = {**recipe, "sig": signature(solid)}
                elif not same_signature(recipe["sig"], signature(solid)):
                    recipe = None
            except Exception:
                recipe = None
            if recipe is None:
                body = replace(body, recipe=None, lost=cause)
            elif recipe is not body.recipe:
                body = replace(body, recipe=recipe)
        out.append(body)
    if assign:
        fresh_taken = False
        for index, body in enumerate(out):
            spec = assign.get(body.id)
            if spec is None and body.id not in known and not fresh_taken:
                spec = assign.get(None)
                fresh_taken = spec is not None
            if spec is not None and index < len(solids):
                out[index] = replace(body, recipe={**spec, "sig": signature(solids[index])}, lost=None)
    return BodyState(tuple(out), state.next_id, state.counts)


def info(body: Body) -> dict:
    """What the frontend is told about a body's recipe."""
    why = reason(body)
    out: dict = {"editable": why is None, "why": why}
    if body.recipe is not None:
        out["recipe"] = {"tool": body.recipe["tool"], "params": body.recipe["params"], "rotated": is_placed(body.recipe)}
    return out


def transform_handles(handles: list[dict], recipe: dict) -> list[dict]:
    """Handles computed in the primitive's own frame, moved to where the (rotated) body is; position handles are dropped
    for a rotated body because the base point is in the primitive's frame."""
    if not is_placed(recipe):
        return handles
    t = list_trsf(recipe["m"])
    out = []
    for h in handles:
        if h.get("kind") == "move":
            continue
        p = gp_Pnt(*h["anchor"]).Transformed(t)
        from OCP.gp import gp_Vec

        d = gp_Vec(*h["direction"]).Transformed(t)
        n = math.sqrt(d.X() ** 2 + d.Y() ** 2 + d.Z() ** 2) or 1.0
        out.append({**h, "anchor": [p.X(), p.Y(), p.Z()], "direction": [d.X() / n, d.Y() / n, d.Z() / n]})
    return out
