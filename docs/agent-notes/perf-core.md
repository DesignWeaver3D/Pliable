# Per-body meshes in the viewport (option C): working notes

Goal: a reply that changes some bodies replaces only those bodies' graphics objects; unchanged bodies keep their
uploaded buffers. Measured before (dev timing log, 120 bodies / 81,600 triangles, undo/redo of an array, delta on):
show -> next frame about 45-70 ms (toFrame + frame), setMesh itself 1-3 ms (it only wraps arrays; the upload happens in
the next frame). The enclosure (114 bodies, 13-15 MB) is much larger; it was not available here.

## Design

- `viewport.data` (merged MeshData) and `viewport.mesh` (merged THREE.Mesh) stay the CPU source for picking, face
  numbers, fit, hover; the merged mesh is no longer drawn (never uploaded).
- Drawing: one front mesh, one edge line object and (surface bodies) one back mesh per body, built from the body's
  own arrays and kept while the body's data object is the same one (`MeshStore` keeps it across deltas).
- Everything that shared the merged vertex buffer for drawing gets its own small copy (marks, band strip) or draws the
  per-body meshes (occlusion probe, back side, slide).

## Consumers of the merged geometry

| Consumer | Status |
|---|---|
| hover / selection / related marks (`Mark`, viewselection.ts) | converted: own triangle copy (no shared vertex buffer) |
| band strip shading (bandstrip.ts) | converted: own triangle copy |
| surface drawing (viewport.setMesh) | converted: `BodyMeshes` (bodymeshes.ts) one mesh + edge lines per body; merged mesh kept for CPU, `visible=false` |
| edge lines | converted with the surface (per body) |
| body colors | converted: per-body color array (`partColors`) |
| see-through bodies (applyGhost) | converted: per-body material (ghost or surface); merged mesh keeps its groups for picking |
| hidden / isolated bodies | converted: `filterHidden` drops the hidden bodies' parts, their meshes are removed |
| section clip | unchanged (traverses the model's materials; the meshes share the materials) |
| back side of surface bodies | drawing converted (per-body mesh sharing the body's geometry); the merged pick mesh stays CPU only |
| occlusion probe (box select) | converted: draws the solid bodies' meshes |
| slide during a move drag | converted: shifts the bodies' own meshes (the merged mesh is not changed any more) |
| raycast / picking / faceStarts / fit / bounds / numbering | unchanged (merged arrays) |

Checked in the app (dev page, 120 bodies, 81,600 triangles): render and colors, hover, face click, hide/show,
isolate, see-through body, see-through setting, section clip, box select, slide, undo/redo.

Visible differences to check by hand: see-through mode draws each body as its own transparent object, sorted by
distance (before: one object in body order); a surface body's back now moves with the body while it slides (before it
disappeared until the reply).
