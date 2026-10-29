"""The ghost of a subtracting push/pull in the preview: the cutting volume minus all bodies, the part in empty space."""

import numpy as np
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.TopAbs import TopAbs_FACE
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS

from .ops import _boolean, _volume_of, solids_of
from .pushpull_modes import compound_of
from .tessellate import ANGULAR_DEFLECTION, _face_arrays, bounds, linear_deflection

MIN_GHOST_VOLUME = 1e-6


def attach_ghost(result, shape) -> None:
    """Set `result.ghost` from the cutting volumes the operation recorded, when part of them lies outside every body."""
    result.ghost = None
    if not result.cutters:
        return
    tool = compound_of(result.cutters)
    solids = solids_of(shape)
    try:
        if solids:
            cut = _boolean(tool, compound_of(solids), False, glue=False)
            ghost = None if cut is None else cut.Shape()
        else:
            ghost = tool
        if ghost is not None and solids_of(ghost) and _volume_of(ghost) > MIN_GHOST_VOLUME:
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
