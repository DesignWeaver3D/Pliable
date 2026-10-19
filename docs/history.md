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

## Alpha decisions (2026-10-17)

Chrome only; everything may change without notice; autosave by the core as BREP snapshots (capped at about 50 steps, doubling as persisted undo); busy indicator with elapsed seconds and no cancel (OpenCASCADE cannot be interrupted); diagnostics shown before copying, with paths reduced to base names; stated size guideline of about 500 faces or 10 MB for single solids. Every feature built before the release ships, whatever its polish.

- S60 Bugs: hole and boss walls drag with push/pull in the view (radius changes), and the measure key is the rebindable action "measure" (default M) in `keys.ts`, shown in hints.
