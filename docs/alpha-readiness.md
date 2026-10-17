# Alpha readiness (written 2026-10-17)

What must be true before inviting others to try Pliable, what was found while checking, and the sessions to get there. Read [progress.md](progress.md) first for the session rules. The portable build and CI plan is session S17 in progress.md; this file adds the sessions that must come before it.

## Decisions made with the user (2026-10-17)

- **Audience and warning.** Everything in the alpha is subject to change without warning, and it must not be used for serious work. Put this notice at the top of the README and the release notes, show a dismissible notice on every launch, and keep a persistent "ALPHA" tag in the UI. Wording: "Alpha software. Not for serious work. Data can be lost. The interface and behaviour will change rapidly without notice."
- **Sketching.** Not ready, and no extra code for it: no flag, no hiding. The README and release notes say it is incomplete and unsupported in this alpha.
- **Browser.** Chrome only. State that everything else is untested.
- **Crash protection.** Automatic backups, written by the core (not the browser) after every committed operation, as native OpenCASCADE BREP (faster than STEP, no translation). Keep a rotating set in the user's data folder, capped at about 50 steps, which doubles as persisted undo history. On launch, if the previous session did not end cleanly, offer "Restore your last session?" (the model and its undo steps). Keep the folder after a clean exit too, so a model closed by mistake can be recovered. STEP stays the user's own export format. Honest limit: this protects against crashes, not against a bad edit; the rotation lets a restore step back past a bad state.
- **Undo memory.** `document.py` keeps whole-shape snapshots in an unbounded in-memory list. Cap it (same cap as above) so long sessions on large models do not grow without limit.
- **Progress indicator.** Show a busy indicator with the operation name and an elapsed timer, appearing after about 300 ms. Use a real progress bar only where the core can report progress (for example the hole batches). No cancel: an OpenCASCADE operation cannot be interrupted, so "cancel" would only mean ignoring the result. Performance itself is not a concern for the alpha (400 holes in 3.8 s may be as fast as OpenCASCADE goes).
- **Diagnostics.** A "Copy diagnostics" button that shows its text before copying. Contents: Pliable version, OS name and version, browser version, Python and OpenCASCADE versions, the last ~50 core log lines with file paths reduced to base names, and the last tool run with its error text. Never model data, file paths, usernames or any personal data. Bug reports go to GitHub Issues with an issue template.
- **Size guideline** to state (after testing): single solids up to roughly 500 faces or a 10 MB STEP file. Multi-solid files and assemblies are best-effort until the multi-solid work below is done.
- **What the alpha promises:** runs on Windows, macOS and Linux; opens and exports STEP; applies the direct-editing tools to single parts of modest size; autosaves and offers recovery. **Best-effort:** STEP from other CAD programs (ask testers to attach failing files), large models, assemblies, units other than mm. **Not promised:** performance, UI stability, sketching, compatibility of anything saved with later versions.

## Findings: STEP import test (2026-10-17)

Test files are in `Z:\3D MODELS\Downloaded 3D Models\STEP Files` (the user's machine; not in the repo). Scripts: `core/scripts/import_check.py FILE` (import, mesh, model info, push/pull, undo, export, re-import, with timings) and `core/scripts/pushpull_sample.py FILE` (12 evenly spaced planar faces, both directions, counts successes). Run from `core/` with `uv run python scripts/...`.

| File | Size | Solids | Faces | Import | Mesh | Push/pull (24 tries) | Export, re-import |
|---|---|---|---|---|---|---|---|
| anycubickobras1headcableholder.stp | 69 KB | 1 | 39 | 0.1 s | 0.1 s | works | works |
| Metric Fastener Gauge.step | 7 MB | 58 | 2,616 | 3.6 s | 8.8 s | 20 ok, 4 fail | works (14.9 MB out) |
| AD5M_Frame.STEP | 11 MB | 49 | 4,007 | 4.0 s | 11.9 s | **0 ok, 24 fail** | works (22.5 MB out) |
| AD5M_Enclosure.STEP | 27 MB | 99 | 8,219 | 9.2 s | 24.5 s | 11 ok, 13 fail | works (57.5 MB out) |

- Nothing crashed or hung. All four import, mesh, export and re-import with the same face count. Undo works.
- A file with several solids loads as one compound with face ids numbered across all solids; selection works across them.
- **Push/pull fails on multi-solid files** with `OperationError: Boolean operation failed`. The tool fuses the extruded face with the whole compound, and these files have stacked, touching or overlapping solids.
- **The AD5M files have bad geometry.** `model_info` reports negative volume (-143,553) and 40 open edges for Frame, 126 open edges for Enclosure. Some solids are inverted or not closed, so part of the failures may be the files, not the tool.
- **Unhandled OpenCASCADE error:** the Gauge file raised `Standard_NoSuchObject` (faces 482 and 1022) instead of a readable message.
- **Slow with no feedback:** opening Enclosure takes about 35 s (import 9 s, mesh 25 s). One Gauge push/pull took 13 s. `model_info` takes 7 to 27 s on the large files.
- **Export is about twice the size of the input** (57 MB from 27 MB). Cause not investigated.
- Only the Python core was tested. Nothing here was checked in the browser (rendering, picking and frame rate on 160k triangles are unknown).

## Sessions before S17 (proposed order)

| # | Goal | Done when |
|---|---|---|
| S18 | **Multi-solid and import robustness.** Make tools act only on the solid that contains the selected face and leave the others alone. Detect inverted or open solids on import (try `ShapeFix` orientation repair; at least flag them in the status line). Catch every OpenCASCADE exception in tools and translate it to a plain message, leaving the model unchanged and undo working. | `pushpull_sample.py` success rate on the AD5M and Gauge files recorded before and after; every failure shows a readable message; tests added for multi-solid and for the error path |
| S19 | **Autosave and restore** as described under Decisions: BREP snapshots after each commit on a background thread, capped, clean-exit marker, restore prompt on launch, capped undo history. | Kill the core mid-session, restart, restore returns the model with undo steps; tests for rotation, cap and the marker |
| S20 | **Busy indicator.** Core sends a busy/progress message for operations over ~300 ms (open, tool commit, export); frontend shows name and elapsed timer; real progress for batched hole tools. Investigate the slow open (25 s mesh on 8k faces) and `model_info` cost, but do not promise a speedup. | A 30 s open shows the indicator and the UI stays responsive |
| S21 | **Alpha warnings, diagnostics and docs.** README and release-notes warning, launch notice and "ALPHA" tag, Copy diagnostics button, GitHub issue template, license notices (AGPL project; py-slvs GPL-3.0; OpenCASCADE LGPL), list of known limitations including sketching, Chrome-only, and the size guideline. | Text reviewed by the user |
| S21b | **Open-body diagnostic** (add to S21's diagnostics): for each surface body that cannot be closed on import, report its number of open boundary loops and whether each is planar (`ShapeAnalysis_FreeBounds`), so we learn whether hole-capping alone would fix real files. | One line per open body in the import warning and diagnostics |
| S17 | Portable build and CI smoke tests (see progress.md). The smoke test should reuse `import_check.py`-style steps on a small bundled STEP file. | As in progress.md |

Also worth adding to the smoke layer when S17 is planned: a headless-browser (Playwright, Chrome) check that the served page loads, the bracket renders and a face can be selected.

## Test checklist for each alpha build

Hand tests (Chrome only), on the bracket and block demos, one imported single-solid file, and one multi-solid file:

1. **Open and export:** open each demo, import a STEP file, export STEP, re-import the export and compare face counts.
2. **Selection:** pick faces, edges and vertices in perspective and orthographic modes; double-click an edge chain; resize the window; use view keys 0 to 6, P and V (including on a cylindrical hole).
3. **Every tool,** each on four shapes: plain, filleted, with holes, curved or cut. Check that a failure shows a clear message, leaves the model unchanged and leaves undo working.
4. **Undo and redo:** chain several different tools, undo all the way back, redo all the way forward.
5. **Drag and typed entry:** for each drag tool, drag, press Esc, and type a value (digits then Enter).
6. **Core stopped and restarted:** the status line says so, the app reconnects, and the restore prompt appears (after S19).
7. **Crash recovery (after S19):** kill the core during an edit and restore.
8. **Long operations (after S20):** the busy indicator shows and clears, including on a failed operation.
9. **Packaged build (S17):** unzip, run, open the bracket, push/pull, export STEP, on each OS or confirm CI is green.
10. **Warnings (after S21):** the launch notice and the ALPHA tag show, and Copy diagnostics contains nothing personal.

## Open items that are not alpha blockers

- Whether sketches persist after extruding (decided against for now), and the perspective-versus-orthographic default (currently perspective).
- Not tested in this round: Firefox, Edge, Safari, high-DPI screens, models over 30 MB, files with non-ASCII paths on Windows.
- The in-memory undo list and the 100+ MB tessellation of large models both affect RAM; measure during S19 and S20.

## After the alpha: surface bodies (idea, 2026-10-17)

Surface bodies that cannot be healed are kept in the model, so they could become useful: cap planar holes to close them; extrude or thicken a sheet face into a solid; loft or bridge between two faces or sketch wires (`BRepOffsetAPI_ThruSections`); sketch on a sheet. Decide after S21b shows how real files fail.

## Feature inventory: everything built ships in the alpha (decided 2026-10-17)

The user's rule: every feature developed before the alpha release goes into it, whatever its state of polish. Keep this table current; add a row whenever a feature lands (in the same commit as the feature). The "Unsupported" column feeds the known-limitations text.

| Feature | Session | State | Hand-test before release | Notes for testers |
|---|---|---|---|---|
| STEP open/export, demos (block, bracket, plate) | S0-S5 | Solid | Checklist items 1 | Chrome only |
| Face/edge/vertex selection, multi-select, edge chains | S3, S7 | Solid | Item 2 | |
| Push/pull, fillet/chamfer, typed values, drag labels | S4, S8, S10 | Solid | Items 3-5 | |
| Toolbar and Ctrl+K command search | S9 | Usable | Item 3 | Placeholder layout (`layout.ts`) |
| Measurement panel and in-view leaders | S12, S13 | Usable | Select each kind on a demo | Units are plain model units |
| Measure mode during drags | S10b | Usable | Right-click while dragging | |
| Nav cube, view keys 0-6, P, V | S14 | Usable | Item 2 | |
| Feature tools (delete face, fillet resize/remove, holes, primitives, shell, mirror, draft, align, move/rotate/scale body, combine STEP) | S15 | Usable, rough | Item 3, every tool | Failures must be readable (checked) |
| Related-face chips (Live Rules) | S15 | Usable | Select a hole, toggle chips | |
| Sketch in 3D, constraints, extrude | S16 | Incomplete | Draw, constrain, extrude join/cut | Stated as unsupported; sketches are not kept after extruding |
| Multi-solid handling, import repair and warnings | S18, S21 | Best effort | Open a multi-solid file | |
| Autosave and restore | S19 | Solid | Item 7 | |
| Busy indicator | S20 | Solid | Item 8 | |
| Alpha notice, ALPHA tag, Copy diagnostics, issue template | S21 | Solid | Item 10 | |
| Portable build, launcher, CI smoke test | S17 | In progress | Item 9 | Unsigned; the launcher exits 20 s after the last tab closes |

Not yet built, so not in the alpha: stretch/extend spike, sketch projection of model edges, sketch fillet/trim.
