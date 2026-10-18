# Agent notes: selection (branch agent/selection)

## S26 settings, pick range, box select: Done (hand-checked in Chrome, 2026-10-18)
- Gear button bottom right opens a settings window (`app/src/settings.ts`): edge pick range, point pick range, see-through toggle; stored in localStorage.
- Box select: drag from empty space (or Ctrl+drag over the model). Left-to-right = window (solid blue), right-to-left = crossing (dashed green). Kind = the currently selected kind, default edges. Ctrl adds. Escape cancels.
- Orbit (right-drag) and pan (middle) work during a tool drag; measure mode moved from right-click to key M.
- Decisions (change if owner disagrees): default edge pick 5 px, point 8 px; box kind rule above; M for measure.
- Environment note: `app/src/sketch.ts` on the base commit contains a Latin-1 degree byte (line ~834) that breaks the Vite dev server. I fixed it locally with a `°` escape but marked the file skip-worktree so it is NOT committed (sketch agent owns it). The orchestrator should make sure it gets fixed at merge.

## S38 see-through: Done
- Toggle with X or the settings window. Surface 30 percent opaque, edges ignore depth, picking has no depth limit, repeated click cycles faces behind.
- Research (from general knowledge, no web run): direct modelers offer (a) an X-ray/wireframe view mode where hidden edges stay pickable, (b) select-through/"hidden line" toggles for box select, (c) cycling picks (Alt+click or a selection list) for stacked items. Built the cheapest mix of (a) and (c).

## S31 edge selection methods: partly done
- Built in `core/src/pliable/edgesel.py` + `edge_selection` request modes `ring`, `sharp` (angle default 30), `region_boundary`; toolbar buttons Edge ring / Sharp edges (one edge selected) and Region outline (several faces). Existing: all edges of a face, face loops, shared loop, double-click smooth chain. Tests in tests/test_edgesel.py. Seen in Chrome (Sharp edges on the bracket).
- Comparison of methods (general knowledge, no web run): direct modelers and mesh/CAD tools commonly offer loop (continue through vertices of valence 4), ring (parallel across quads), tangent chain (continue while smooth), by-angle (flood fill over edges above a dihedral threshold), boundary (outline of a face set), and shared-face loops. All are now present except a UI angle slider for sharp edges.
- Decision: 30 degrees default; change `angle` in `selectionHelpers` in main.ts.
- Still open: offset of inner loops (inset_face handles the outer loop only), placing the divide edge by dragging in the viewport.

## S35 relationship rules and design intent: partly done (Parked remainder)
- Built: hole and boss centres are sent in the mesh header (`centres`), drawn as blue dots, and picking one selects the hole face (so tools, measuring and centre-to-centre dimensions work from it). Chips and equal-radius off by default were done earlier.
- Decision: no separate "centre" selection kind (would need ids through every tool); the dot is an alternate pick target for the face. Change in `nearestCentre` in viewport.ts if the owner wants a real point kind.
- Parked: per-tool defaults for the "applies to" choice (today one global chip toggle, off by default, so one hole moves alone), and dragging a centre as a move handle.

## S32 eyedropper: Done (hand-checked in Chrome: Resize hole diameter copied from another hole)
- Button next to length/angle fields in the tool form; click an item to copy its radius/diameter/length (see `readValue` in main.ts). Esc cancels. Works for fillet faces too (they report Radius); not hand-checked on a fillet.
- Decision: matching by field name, see watchlist.

## Where to resume
All five sessions handled. Open items: S31 offset of inner loops and dragging the divide edge in the viewport; S35 per-tool defaults and centre as drag handle; S26 box select always uses the selected kind (no kind switch in the UI).

## Wave 2a
- S31: inset_face has a `loop` parameter (inner loops, grows outward around the hole); Sharp edge angle slider in settings. Dragging the divide edge in the viewport: PARKED (needs an in-plane drag handle like the hole centre one; use `startCentreDrag` in viewport.ts as the pattern).
- S35: per-tool rule defaults (`TOOL_RULES`, `ruleFor` in main.ts; Resize hole defaults to also resizing same-size holes, everything else off; change there if the owner disagrees). Hole centre dots are drag handles for Move hole (`startCentreDrag`; centres now carry `axis`). Checked in Chrome: dragging the upright hole's dot moved it and committed (Undo enabled).
- S30 selection side: Alt+click cycles faces under the pointer (also hidden); fast multi-zone pick = box select with Box selects = Faces. sketch.ts not touched.
- S26: "Box selects" kind switch (Auto/Edges/Faces/Vertices) in the settings window.
- Not hand-checked in a browser: per-tool chip behaviour, inset loop, sharp slider, kind switch (type-checked; inset and axis have tests).

## Wave 2b
Status: S26 box select exactness, S31 edge selection fixes and divide drag, S35 and S38 verification are Done. Hand-checked in Chrome on port 5203 (core 8803) unless noted.

### Owner bug reports (done first)
- Box select: tests moved to `app/src/boxselect.ts` (pure, tested in `app/tests/boxselect.test.mjs`, 4 tests). Window = every end of every edge segment or corner of every face triangle inside the rectangle. Crossing = any edge segment or any face triangle (exact triangle-rectangle overlap, including a box wholly inside a face) touches the rectangle. The old code used bounding boxes for faces in crossing mode and the first triangle centre for visibility. Visibility is now sampled at several points (up to 6 per edge, 12 triangle centres per face) inside the box and an item counts if any sample is visible. Checked: crossing box over the bracket took the 4 edges it touched, window box took only the one fully enclosed edge. I could not reproduce "window selects objects not fully enclosed" with the old code by reading it, so that part is a fix by rewrite, not a confirmed root cause. Selecting faces by window needs the whole face (all triangles) inside.
- Edge buttons: with one edge selected the toolbar now shows Edge loops (new `edge_loops` mode: the loop of each face beside the edge, shared faces decide, no angle), Edge ring, Sharp edges, each with a tooltip and a status message when nothing more is found. Root cause of "ring does nothing": the ring only crossed faces with exactly four edges and the bracket has none (rounded corners, holes); on a hole rim it selected only itself with no message. Ring now also crosses a face of more edges by taking the farthest parallel straight edge (the base front-top edge gives a 5 edge ring). Double-click on an edge now takes the face outlines (same as Edge loops) and falls back to the smooth chain only when the outline is just the edge; with another edge already selected it still takes the shared loop. Highlighting works (13 edges lit for the base-top edge).
- Alt+click cycling bug found and fixed: `facesUnder` used a ray test that skips back-facing triangles, so with see-through off Alt+click could never reach the face behind the top face. Now double sided for that test. Checked: top face then bottom face with see-through off, and top then bottom with it on.

### Decisions made without the owner (change if you disagree)
- Double-click on an edge: face outlines instead of the tangent chain (the owner wants shared faces, not angle). To get the old behaviour back, call `edge_chain` first in `viewport.onEdgeLoop` in main.ts.
- Ring rule for faces with more than four edges: farthest parallel straight edge not touching the current one.
- Divide drag: the dividing line is parallel to the face axis that moved less during the first 4 px of drag (movement mostly along the second axis keeps `across` 0). Pressing on the model while the Divide face form is open starts the drag, so you cannot select something else by clicking the model while the form is open (Cancel first). Tool: `startDivideDrag` in viewport.ts, request `face_frame`.
- Box select drag starts from the model only with Ctrl or from empty space, as before; a plain drag starting on a selected face still starts the tool drag.

### Selection filter design note (not built, requested by owner)
Today there is one rule: the Box selects setting (Auto, Edges, Faces, Vertices; `settings.boxKind`, applied in `finishBox` in viewport.ts). Auto means the kind of the first current selection, edges when nothing is selected. Plain clicks have no filter: the nearest vertex within the point range wins, then a hole centre dot, then an edge within the edge range, then a face (`pickHit`). Alt+click cycles faces only. A filter design could replace `boxKind` with a set of allowed kinds used by both `pickHit` and `itemsInBox`.

### Verified in the app
Alt+click cycling (off and on), per-tool chip (Resize hole shows the checked chip, Move hole shows the add chip), box kind switch Faces (8 faces) and Vertices (2), Edges crossing and window, Sharp edges button with the slider at 90 degrees (the demo bracket only has 90 and 0 degree edges, so a smaller angle gives the same set; the angle reaches the request and the tooltip), Inset face outline loop 0 and loop 1 preview on the base top (ring around one hole), unsaved-work warning (defaultPrevented true with an undo step, false after undo), Divide face by dragging (committed, 20 faces, split kept, undone).
Not checked: Edge ring on a block edge by hand (tested in core), shared-face loop by double-clicking a second edge, fillet eyedropper.

### Resume point
Nothing half-done. Possible next work: selection filters design, window/crossing for sketch zones, box select cost on large models (samples rays per item).
