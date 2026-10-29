"""The ghost of a subtracting tool (push/pull, holes, revolve, sweeps) in the preview: the cutting volume minus all bodies, the part in empty space."""

import numpy as np
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.TopAbs import TopAbs_FACE
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS
from OCP.collections import List_TopoDS_Shape

from .ops import _volume_of, solids_of
from .pushpull_modes import compound_of
from .tessellate import ANGULAR_DEFLECTION, _face_arrays, bounds, linear_deflection

MIN_GHOST_VOLUME = 1e-6


def _outside(cutter, others):
    """`cutter` minus every shape in `others` (None when the boolean fails)."""
    operation = BRepAlgoAPI_Cut()
    arguments, tools = List_TopoDS_Shape(), List_TopoDS_Shape()
    arguments.Append(cutter)
    for other in others:
        tools.Append(other)
    operation.SetArguments(arguments)
    operation.SetTools(tools)
    operation.SetRunParallel(True)
    operation.SetNonDestructive(True)  # the inputs belong to the document
    operation.Build()
    if not operation.IsDone() or operation.Shape().IsNull():
        return None
    return operation.Shape()


MAX_OVERLAPPING_CUTTERS = 3  # more cutters than this (the turns of a coil) are pieces that do not overlap and are cut in one go


def attach_ghost(result, shape) -> None:
    """Set `result.ghost` from the cutting volumes the operation recorded, when part of them lies outside every body.
    A few cutters may overlap (a hole and its counterbore, the parts of a slot): each is cut by the bodies and by the cutters before it,
    so no part is drawn twice. Many cutters are taken as separate pieces and cut together, which is much faster."""
    result.ghost = None
    if not result.cutters:
        return
    solids = solids_of(shape)
    try:
        if len(result.cutters) > MAX_OVERLAPPING_CUTTERS:
            pieces = [_outside(compound_of(result.cutters), solids)] if solids else list(result.cutters)
        else:
            pieces = [_outside(cutter, [*solids, *result.cutters[:i]]) if solids or i else cutter for i, cutter in enumerate(result.cutters)]
        pieces = [piece for piece in pieces if piece is not None and solids_of(piece)]
        ghost = compound_of(pieces)
        if pieces and _volume_of(ghost) > MIN_GHOST_VOLUME:
            result.ghost = ghost
    except Exception:  # the ghost is only a drawing aid; it never fails a preview
        result.ghost = None


def ghost_reply(ghost) -> tuple[dict, dict]:
    """The reply's `ghost` header and its binary buffers (same layout as the bodies' positions, normals and indices)."""
    BRepMesh_IncrementalMesh(ghost, linear_deflection(ghost), False, ANGULAR_DEFLECTION, True)
    positions, normals, indices, base = [], [], [], 0
    explorer = TopExp_Explorer(ghost, TopAbs_FACE)
    while explorer.More():
        data = _face_arrays(TopoDS.Face(explorer.Current()))
        if data is not None:
            pos, nrm, idx, _ = data
            positions.append(pos)
            normals.append(nrm)
            indices.append(idx + np.uint32(base))
            base += len(pos)
        explorer.Next()
    buffers = {
        "ghostPositions": np.concatenate(positions).astype(np.float32) if positions else np.empty((0, 3), np.float32),
        "ghostNormals": np.concatenate(normals).astype(np.float32) if normals else np.empty((0, 3), np.float32),
        "ghostIndices": np.concatenate(indices).astype(np.uint32) if indices else np.empty(0, np.uint32),
    }
    return {"triangles": int(buffers["ghostIndices"].size // 3), "bounds": bounds(ghost)}, buffers
