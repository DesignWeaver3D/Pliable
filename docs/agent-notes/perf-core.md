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
