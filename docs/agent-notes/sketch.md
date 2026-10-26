# Sketch agent notes (branch agent/sketch)

## Rows

- White viewport after a symmetry constraint: PARKED (still open). Third approach done: the solver now reports failure when a solved point is not finite or beyond 1e9 (core test added). Earlier: frame-part guard, core fuzz. Not reproduced. Next ideas: log `renderer.info` and context state when it happens; check the profile-fill mesh (`refreshProfiles`) and the dimension overlay for NaN. The "project state does not always restore" sub-row was not touched. Keep the row open.
- Constraints list scrolls on its own: done (rows scroll, card buttons stay).
- Delete buttons use a trash can: done (`deletebutton.ts`, sketch list, datum list, constraint rows; behavior.md wording changed from "x" to "trash can button"). The mirror-mode "off" button keeps the X on purpose (it is not a delete).
- New Project clears the tool first: done.
- Constraint marks hide arc and circle centres: done for marks (tag moves above the centre). Dimension text on arcs and circles was not changed.
- Fully constrained colouring: partly done. A sketch with no degrees of freedom colours all points at once; budget 0.4 s to 1 s. Known gap: a circle with a placed centre but a free radius still colours as placed (entity colour only looks at points). Row can be deleted if the owner accepts that; otherwise it stays for radius freedom.
- Degrees of freedom message: done. Click lights free points and curves yellow. The count itself was not changed: when one degree is reported and nothing lights up, the message says the freedom is in a size (radius or axis). Not verified why the solver counts a degree in the owner's case.
- Trim: partly done. Crossings now include arcs (the likely cause). Ellipses and splines are still ignored. Extend also reaches arcs now.
- Split at a constrained point: done (behavior.md line added). Coincidence comes from the shared point id.
- Newest user constraint wins: done (behavior.md line added); provisional order of removal (first blamed automatic). Not checked in Chrome (no easy clash case was found with the buttons).
- Arc radius leader: done; the "helper construction arc" is a dashed extension drawn with the dimension, not geometry (provisional).
- Sketch 2D fillet and chamfer: partly done: line-line corners only (tools in the sketch row, size in the card). Line-arc corners not built; the row stays open for that.
- Pre-filleted rectangles: provisional only. The rectangle tools already have a corner style list (Square, Rounded, Bevelled) and a size in the sketch card, so only the tooltips changed. Proposal: keep that list, and if the owner wants it on the fly, add a key that cycles the style while drawing; a separate drop menu in the strip is not needed.
- Sketch hotkeys: provisional build. Answer to the question: yes, sketch-only keys are possible and the key table already allows them (D is one; a sketch-only command may share a key with commands that are not available in a sketch). Built C, E, S, H, T, L, R. Conflicts: P (perspective toggle) and V (look at face) stay active in a sketch, so Parallel and Vertical commands exist with no default key. H, T (hide body, drawer) are not available in a sketch so nothing was taken away.
- Dimension and Horizontal/Vertical variants under one tool: PARKED, not built. It changes the approved constraint row in behavior.md. Proposal: under Dimension, a drop list with Dimension (smart), Horizontal distance, Vertical distance; under Horizontal / vertical, a drop list with Horizontal / vertical (smart), Horizontal only, Vertical only; keep the existing buttons working as now until the owner approves. Today Horizontal, Vertical, Horizontal distance and Vertical distance are separate buttons in the row already.
- Global display precision: provisional build. Rounding limit answer: the core works to about 1e-7 (OCC confusion tolerance); sketch checks use 1e-6; mouse drags round to 0.001; displays used 2, 3 or 4 decimals in different places. The new setting (1 to 8, default 3) covers the measurement panel and sketch dimensions and fields; the tool forms and manipulator labels (other agent's files) and drag values are not covered.

## Decisions (also in docs/decisions-log.md and docs/testing-checklist.md)

Auto versus dimension redundancy; arc leader extension; pre-filleted rectangles; sketch keys; display precision.

## Questions for the owner

- Do you want P and V in a sketch to apply Parallel and Vertical, giving up the perspective toggle and look at face in a sketch? Default: no, they stay unassigned.
- Should an arc radius leader past the arc end create a real construction arc instead of the dashed extension? Default: dashed extension only.
- Should the fillet and chamfer tools also work on a line meeting an arc? Default: yes, as a later step.
- Should the pre-filleted rectangle choice also be switchable while drawing (a key that cycles square, rounded, bevelled)? Default: no, the card list is enough.

## Delete or change in progress.md

Delete rows: Constraints list scrolls on its own; Delete buttons use a trash can icon; New Project clears the tool first; Split should split at a constrained point (after hand-test); Automatic redundant constraints (after hand-test); Sketch constraint marks hide arc and circle centre points (after hand-test).
Keep with a remaining part: White viewport; Fully constrained colouring (circle radius); Degrees of freedom (the count discrepancy); Trim (ellipses and splines); Arc radius leader (owner decision on the helper arc); Sketch fillet and chamfer (line-arc); Pre-filleted rectangles (discuss); Sketch hotkeys (P and V); Dimension variants (parked); Global precision (tool forms, drags).

## Resume point

All rows were worked once. Next: white viewport investigation with a live repro, then the remaining parts above. The browser checks done: constraint list scroll, trash icons, yellow freedom highlight, fillet tool. Not checked in Chrome: arc leader, split at point, Trim at arcs, sketch keys, precision setting, New Project, auto-wins, centre tags.
