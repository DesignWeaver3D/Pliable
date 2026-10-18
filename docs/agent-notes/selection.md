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
