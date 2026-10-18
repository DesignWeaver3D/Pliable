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
