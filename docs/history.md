# History

One line per finished session, with the findings worth keeping. Open sessions are in [progress.md](progress.md). Detail for any session is in the git log.

## Sessions

- **S0-S5 Spike:** Python core and tests, tessellation, Vite + TypeScript + Three.js frontend, face picking, push/pull drag with live preview, STEP open/export, latency report.
- **S6-S8 Core:** declarative Tool API (accepted selection, typed params, preview/commit) with registry and `protocol.md`; face/edge/vertex selection; fillet/chamfer with edge drag.
- **S9-S11 Interaction, MVP:** contextual toolbar and Ctrl+K search; drag labels with Tab/typed entry and measure mode; parity check with `v0.1.0-poc` (merged to `main`, tag `v0.2.0-mvp`).
- **S12-S13 Measure:** measurement panel for edges, faces, vertices, multi-select totals and two-item distance/angle; drafting-style leaders on the model (overlapping labels are dropped, panel still lists them).
- **S14-S16 Overnight:** nav cube, view keys, perspective/ortho, look at face; tool list with typed-value forms and the feature tools (delete face, fillet/hole/boss editing, patterns, primitives, shell, mirror, draft, align, move/rotate/scale, combine STEP); sketch in 3D on the SolveSpace solver with extrude join/cut.
- **S18-S21 Alpha:** multi-solid and import robustness with translated OpenCASCADE errors; autosave and restore; busy indicator; alpha notice, ALPHA tag, Copy diagnostics, issue template, license notices, known-limitations.
- **S22-S24 Parity:** Tier 1 (body booleans, torus, revolve, unify, arrays, split, asymmetric chamfer, STL/3MF/OBJ export, hide/isolate), Tier 2 (variable fillet, loft, sweep, array along path, sketch polygons/trim/extend/offset, construction planes), Tier 3 spikes (patch fill, bridge).
- **S25 Quality:** extra edges and faces after operations were not reproduced; `tests/test_seams.py` covers out-and-back and all-tools sweeps and found no seams. Needs the owner's exact steps.
- **S26 Input:** settings window (pick ranges, see-through, box kind, sharp-edge angle), box select (left to right encloses, right to left touches), orbit/pan during a tool drag, measure pick moved to the M key.
- **S27 Reference:** axes and origin drawn; point picker (origin, axes, face centre, axis meets face, model vertices and edge points); sketches get fixed reference points and snap to in-plane axis lines.
- **S29 Bodies:** primitives and sketch extrusions make separate bodies by default (`new_body`, mode `new`); move/rotate/scale/offset act on the solids containing the selected faces.
- **S31 Edges:** all edges of a face, face loops, shared-face loop, ring, sharp edges, region outline, smooth chain; inset face outline (outer and inner loops); divide face by number or drag.
- **S32 Eyedropper:** copies a radius, diameter, length or angle from the model into a tool form field.
- **S33 Unwrap:** sketch on unrolled cylinders, cones and tangent chains, regions across the seam, Emboss/Cut along surface for curved faces. Spheres, tori and free-form faces cannot unroll without distortion.
- **S35 Intent:** relationship chips as clear toggles with per-tool defaults (Resize hole also resizes same-size holes), hole centre dots as pick targets and move handles, centre-to-centre and centre-to-face dimensions, Center between faces in any pick order.
- **S37 Fillets:** Resize fillet edits constant and variable fillets; Fillet per edge has one start/end radius row per edge. The kernel offers no variable chamfer.
- **S38 See-through:** X toggles a 30% opaque surface with hidden edges pickable; repeated clicks and Alt+click cycle faces behind.
- **S39 Usage:** in-memory tool-usage counts shown in the diagnostics report only.
- **S40 Keys:** policy in `keys.ts`, router in `keyrouter.ts` (pointer engagement for bare keys, fixed sketch keys, user-rebindable others, unsaved-work warning on leaving).
- **S41-S42 Quality:** each running copy autosaves in its own `inst_<id>` folder with a heartbeat lock; the alpha notice is acknowledged once per user (`NOTICE_EPOCH`).
- **S57-S59:** box select rewritten on exact projected geometry; Edge loops/ring/sharp edges with messages and tooltips; a plain-language description on every tool, shown as tooltips.
- **S36 Stretch:** `stretch` tool (move mode re-fits flat neighbours, insert mode; refuses curved neighbours).
- **S43-S46 Sketch:** one Sketch On Face button with visible automatic constraints and a diagnostic fallback; axes, vertices and tilted circles projected; ellipse and spline with end-point constraints; chains of adjacent and curved faces flattened into one sketch face.
- **S49, S52 Tools:** arrays act on the chosen body; Center between faces needs one side face.
- **S50, S51 Selection:** chips off by default with All/None and Parallel/Symmetric; see-through draws faces nearly clear with a button.
- **S53-S55 Shell:** any Ctrl/Alt/Shift mix; drafting dimensions and leaders; hint line and first-use tips.
- **S61-S63:** one Import STEP choice and mesh export dropdown; perimeter-only Edge loops, tangent-only double-click, Shift+click adds, smaller pick ranges on small faces; reconnect with backoff and defensive measurement updates (the stall was not reproduced).
- **S28, S47, S64, S66 Gizmos:** on-screen handles (primitives with grips on every side, move/rotate/scale body, push/pull arrow, fillet and chamfer handles), axis-coloured move arrows, base-point and destination picks, typed values during a handle drag.
- **S34 UI:** floating tool strip, search field, procedural icons, Tools handle with the toolbox icon on the left edge, view controls beside the nav cube, keyboard shortcuts reached from Settings, `?` and search.

## Parked by design

Ellipse/spline sketch curves (solver has neither; S44), project curves onto faces, groups/layers/colours (document model change), thicken surface, fillet setbacks, G2 patch continuity, deform, T-splines, variable chamfer (kernel), sketch persistence, spheres/tori/free-form unwrap, per-body pivot for rotate/scale, dragging push/pull on curved faces, open-surface display (free edges are not highlighted).

## Spike findings

Push/pull of the top face, headless; end-to-end over the WebSocket was the same within a few ms.

| Model | Faces / triangles | Preview median | Commit |
|---|---|---|---|
| block | 6 / 12 | 12 ms | 11 ms |
| bracket | 19 / 680 | 44 ms | 45 ms |
| perforated plate (stress) | 410 / 43k | 2.5 s | 3.0 s |

Interactive models (tens of faces) preview in 12-45 ms. The stress model's mesh stays near 1.5 s: `BRepMesh_IncrementalMesh` costs about 870 ms on the ~410 new hole-wall faces regardless of deflection (per-face overhead), plus ~600 ms of Python per-node loops because OCP exposes no bulk arrays. Untouched faces keep their triangulation, but a cache keyed on `TShape` never hits because the operation copies topology. Ideas not tried: ocp-tessellate, caching on the triangulation, a lower-quality preview mesh.

## Import test (2026-10-17, files outside the repo)

Four STEP files (39 to 8,219 faces, 69 KB to 27 MB) all imported, meshed, exported and re-imported with equal face counts; none crashed. Large files take 4-9 s to import and up to 25 s to mesh. Two multi-solid files contained inverted or open solids (negative volume, 40-126 open edges), which caused most push/pull failures before S18 made tools act only on the containing solid. Export is about twice the input size (cause not investigated). Most open surface bodies have flat open loops, so hole capping would close many but not all.


- **S28 and S47 handles:** tools declare on-screen handles (`Handle` in `tools.py`, `tool_handles` request, `manipulator.ts`); used by the primitives (sizes and X/Y/Z arrows), move/rotate/scale body, push/pull, fillet/chamfer distance, variable fillet (start, end, interim radius, interim point along the edge, click to swap ends) and chamfer with two distances (both legs, click to swap sides). Not built: handle for the chamfer angle, per-edge fillet radii, a handle for the rotate axis. Checked in the app except scale body and chamfer.

## Alpha decisions (2026-10-17)

Chrome only; everything may change without notice; autosave by the core as BREP snapshots (capped at about 50 steps, doubling as persisted undo); busy indicator with elapsed seconds and no cancel (OpenCASCADE cannot be interrupted); diagnostics shown before copying, with paths reduced to base names; stated size guideline of about 500 faces or 10 MB for single solids. Every feature built before the release ships, whatever its polish.

- S60 Bugs: hole and boss walls drag with push/pull in the view (radius changes), and the measure key is the rebindable action "measure" (default M) in `keys.ts`, shown in hints.
- S67 Gizmos: the primitive base-point list is gone; "Pick base point" takes any snap point (the preview's corners, edge midpoints, face centres, centre, or any model/axis/origin point) and the shape moves by destination minus base, with a base marker and a line to the hovered destination.
- **S65 Bodies:** stable body ids and names in the core (matched after each operation by shape, box overlap and volume rather than per-operation face history; see watchlist), auto names from the tool, STEP part names kept, rename as an undo step, `bodies` in the mesh header and `body` on faces, edges and vertices. Left drawer section with a plain body list (name, eye, isolate, right-click Rename with disabled Duplicate and Delete); hide and isolate keyed by body id. Row click, Ctrl and Shift select whole bodies; move, rotate, scale and offset use selected bodies, rotate and scale pivot about each body's centre; hover highlights both ways. Follow-up: a double-click on a face selecting its whole body is not built; the drawer still closes when the view is clicked, so row highlights from view hover show only while it is open.
- **S68 Bodies:** editable primitives. Each primitive body keeps a recipe (tool, values, placement) in its body record, so it survives undo, redo and autosave; it stays editable while its shape matches a signature (volume, face count, box). Moves, rotations and uniform scales update the recipe; any other shape change drops it with a reason (`Changed by Fillet/Chamfer`), and combining with another solid ends it (option A). "Edit primitive" on the body row menu (greyed with the reason) and in the tool strip reopens the form and handles with the stored values; Apply is one undo step keeping id, name and hidden state. A double-click on a face selects its whole body.

- S48 Holes: `holes.py` reads a round hole (axis, diameter, depth or through, counterbore and countersink stages, bottom) from any face or its rim and reports it as `hole` on measured faces and edges; Edit hole (`hole_tools.py`) changes diameter, depth and position with an axis-line gizmo (depth grip with through at the end of its range, diameter grip, move arrows); Convert hole to countersink (diameter and included angle) is separate from the edge chamfer; hole axis ends and centres are point-picker snaps; hole tools say "pocket or slot" for non-round cuts. Questions 1-4 were decided by their defaults (see decisions-log). Not covered: obround slot recognition, equal-diameter rule for Edit hole, conical bottoms are read but only rebuilt with their angle.
