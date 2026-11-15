# Sending only the changed bodies: design proposal (no code)

Goal (owner: "Begin 4 when ready."): after an edit, the reply carries only the bodies that changed and the page replaces
just those meshes, instead of the whole model (13-15 MB on a 114-body model). This is for the owner to approve first.

## Current flow

1. Every handler ends in `Session._mesh_reply` (core/src/pliable/server.py:78, 22 call sites). It calls
   `tessellate(topology, preview)` (tessellate.py:346) and `encode_mesh` (protocol.py:54), which writes one binary frame:
   JSON header (faces, edges, vertices, centres, bodies, bounds, canUndo, sketches, datums...) plus four buffers
   (positions, normals, indices, edgePositions). serving.py:45 sends a small JSON frame, then the binary frame.
2. `tessellate` asks `bodydisplay.body_ranges` (bodydisplay.py:59) whether each body owns one contiguous block of face,
   edge and vertex ids; if so `bodydisplay.assemble` (:174) joins the cached per-body `BodyData` (:36, cache key :76)
   and numbers faces/edges/vertices by block offset. If not (shared sub-shapes, loose shapes such as the 159 outside
   solids after a STEP import) it takes `tessellate_whole`. So the per-body data already exists; only the join and the
   send are whole-model.
3. Page: `decodeMesh` (client.ts:60) builds a `MeshData`; `CoreClient.onMessage` (client.ts:157) resolves the request
   promise; callers use `setCommitted`/`show` (modelview.ts:67, :34), which prune hidden state, call `filterHidden` and
   `viewport.setMesh` (viewport.ts:385). `setMesh` drops every child and builds one merged BufferGeometry, with
   `faceStarts`, `buildBack`, colors and marks all indexed by the global face/triangle order.

## The id problem

Face, edge and vertex ids are positions in the whole model's indexed maps (topology.py), contiguous per body, in body
order. The page sends those ids back (`selectionPayload`, selection.ts) and the core resolves them with `topology.face(id)`,
so the page's ids must equal the core's at every moment. Deleting, adding or changing the face count of an early body
shifts the ids of every later body, even though their meshes did not change. `FaceRange.body` / `EdgeRange.body` /
`VertexInfo.body` already carry the stable body id (`owner.id`); `solid` is the position and also shifts.

## Options

**A. Stable per-body id blocks (ids no longer global).** Give each body a fixed id block (e.g. body key * 2^20 + local)
so nothing shifts. Core: `Topology` indexing, `selection`, every tool, `recipes`, `facemerge`, undo and file formats all
use global positions; this touches most of core. Risks: selection/undo/autosave restore all change meaning; very high
regression risk (the owner's main complaint). Size: 15+ commits. Not recommended.

**B. Delta reply, page renumbers (recommended).** Ids stay global in the core. The reply lists all bodies in order
with their face/edge/vertex counts, and carries buffers and records only for bodies the page does not already hold at
the same revision. The page keeps a per-body store (a local copy of each body's `BodyData` plus its records with local
numbers) and rebuilds a full `MeshData` identical to today's (offsets summed from the counts), so selection, hidden
bodies, `setMesh` and every other consumer stay unchanged. Saves network, decode and header JSON (the 13-15 MB), not the
GPU buffer rebuild (a memcpy-scale cost in the page).
- Core: `BodyData.rev` (counter set when built, so a cache hit keeps its rev, also across undo). `assemble` also returns
  the per-body parts. `Session.sent` = {body id: rev} of the last reply of this connection. `_mesh_reply` (one place) sends
  a delta when the request opted in at `hello`, `body_ranges` is not None, and `base` matches; otherwise a full frame.
  Header: `delta: {version, base, bodies: [{id, rev, faces, edges, vertices, changed}]}`; changed bodies carry their
  buffers (with the per-body start offsets) and records. Always whole and small: `bodies` info, bounds, sketches, datums,
  centres of changed bodies only, canUndo/canRedo.
- App: new `meshstore.ts` (pure: apply delta to store, produce `MeshData`; node tests with fixtures). `CoreClient.onMessage`
  applies every delta to the store before resolving the promise (so a reply that `LatestWins` later discards is still
  applied: this is essential, the store must follow the core's `sent`). A `full_mesh` request resyncs when `base` does not
  match or applying throws.
- Risks: store and `sent` drifting apart (versions + resync; dev check with `?dev=1` comparing a delta result with a
  full reply); hidden bodies (page-side filter after the rebuild, unchanged; core still sends them); surface bodies
  (ordinary bodies with `surface` in `bodies` info; loose faces force a full reply); undo (revs of cached bodies match,
  bodies absent from the page's store are sent); autosave restore, `resume_session`, `restore_session`, open, new
  project, reconnect: always full and reset `sent` and the store; previews (each carries its own `preview` flag in the
  rev; the base is simply the last reply, so drags benefit most).
- Size: 5 commits (below).

**C. B plus per-body GPU meshes in the viewport.** The page keeps one THREE.Mesh per body and replaces only changed
ones, saving the GPU buffer rebuild too. Touches `setMesh`, `installTreeRaycast`, `buildBack`, `bodyColorArray`, marks,
`faceStarts`, hover and selection highlight (viewport.ts and its helpers). Worth doing only if a profile shows
`setMesh` cost after B. Size: 6-8 more commits, medium risk.

## Recommendation and order

Option B, then measure; C only if `setMesh` shows up. Commits, each with tests, none changing visible behavior until the
last:
1. Core: `BodyData.rev`; `assemble` split so per-body parts are available; test that the join is unchanged.
2. Core: delta encoding in `protocol.py` + `Session.sent`/version, opt-in at `hello`, `full_mesh` request; Session.handle
   tests (delta after one-body edit has one changed body; delete of an early body renumbers; undo; ranges None gives full).
3. App: `meshstore.ts` + node tests (offsets, renumbering, removal, resync trigger).
4. App: wire into `CoreClient` (opt-in at hello behind `?dev=1` first), dev-mode comparison against `full_mesh`.
5. Turn it on by default, re-measure on the 114-body model with the scripts in `C:\dev\pliable-wt\perf\`, add a watchlist
   entry (shortcuts: loose-shape fallback, resync path).
Core commits 1-2 touch `bodydisplay.py`, `server.py`, `protocol.py`, which the speed agent is also changing: start after
its branch is merged.

## Questions for the owner

- Approve option B (page renumbers, core ids unchanged) over A? Default: B.
- Turn on by default at commit 5 after a hand check of selection after delete/undo on a many-body model? Default: yes.
