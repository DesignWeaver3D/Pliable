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
| raycast / picking | converted: one triangle tree per body kept while the body's data is the same (viewraycast.ts); on a one-body change the first hover after it costs about 0.2 ms (was a 13 ms plain test, then a 50 ms tree build over all 81,600 triangles) |
| section view slice (sectionview.ts) | converted: `sliceParts` keeps each body's cut loops while the body and the plane stay; with the section view on, a one-body change took a 150-200 ms task (next frame 150-280 ms), now 50-85 ms. The caps/hatch/overlap part (about 45 ms) still runs over every cut body: not converted |
| hidden bodies filter (filterHidden) | converted to block copies (5-9 ms -> about 1 ms at 81,600 triangles) |
| faceStarts / fit / bounds / numbering | unchanged (merged arrays) |

Checked in the app (dev page, 120 bodies, 81,600 triangles): render and colors, hover, face click, hide/show,
isolate, see-through body, see-through setting, section clip, box select, slide, undo/redo.

Visible differences to check by hand: see-through mode draws each body as its own transparent object, sorted by
distance (before: one object in body order); a surface body's back now moves with the body while it slides (before it
disappeared until the reply).

## Result and resume point

Bytes uploaded for a one-body change (undo/redo of an added box, 120 other bodies): about 1 KB in 13-18 buffer calls,
against the whole merged mesh (about 5 MB here) before. The dev log's frame time does not show it on this machine
(the log's "frame" is dominated by animation-frame pacing: undo/redo of one body 60-90 ms before and 40-70 ms after
with 81,600 triangles); the enclosure was not available, so its 1 s figure was not re-measured. First hover after a
change: 13 ms plain test then a 50 ms tree over all triangles before; about 0.2 ms after.

Not converted / left: the join of the merged CPU arrays in `MeshStore.join` (copies every body's arrays on each reply,
about 11 ms apply at 81,600 triangles); the caps, hatch and overlap of the section view (about 45 ms, over every cut
body); a mesh from a whole reply rebuilds every body. Not checked in the app: a surface body's back side (unit tests
only; no surface body was built).
Hand-check: see-through mode, a surface body's back side, sliding a body with a move handle.
Resume: nothing half-done. Next candidates are the two items above.
