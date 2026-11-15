# perf-core notes (agent/perf-core)

## Typed arc direction
The committed typed arc is always counterclockwise (`addArc` is called with `placingTyped`; behavior.md: "A typed sweep in degrees is always counterclockwise"),
and `sketchpreview.ts` already drew it that way (`positiveSweep`). The odd one out was the angle dimension drawn by `sketchtypeddims.ts`: it went clockwise at
exactly 180 degrees (`turnShortWay` gives -pi) and followed the pointer's side above 180. It now uses `positiveSweep(turnShortWay(..))` and the typed degrees as they are.
Test: `app/tests/sketchpreview.test.mjs` (90, 180, 270 degrees, pointer on either side).

## Zero turn (`arcBetween` vs `positiveSweep`)
- `arcBetween` (sketchshapes.ts) is used only for rubber bands: the slot's two end arcs (sketchpreview.ts), the arc by ends and radius (`radiusArcPoints`) and the tangent arc (`tangentArcPoints`).
  Each is built from two distinct points (slot: opposite tangent points at a positive half width; radius arc: `chord < 1e-9` returns null; tangent arc: `reach < 1e-9` returns null),
  so a zero turn cannot reach it. No test covers a zero turn there.
- `positiveSweep` is used for a stored arc whose end is the same point as its start (`arcSpan`, `polyline`) and for a typed sweep: a zero turn there is a full circle, which is
  what typed 360 degrees makes (the end point is the start turned a full turn) and what `sweepCounterclockwise` (ellipse arcs) does too.
- Nothing reaches both with a zero turn, so no behavior differs and no code was changed. If an end ever coincided with the start in a rubber band, `arcBetween` would draw nothing
  where the stored arc is a full circle; the unreachable case is left alone.

## Hole with "Other bodies" on the 114-body enclosure (scripts: `C:\dev\pliable-wt\perf\ph_seq3.py others 4 3`, `ph_phase.py`, `ph_share*.py`)
Where the time went (a 3 mm deep, 2 mm hole, model settled by four moves first): whole-model boolean 1.8 s, whole-model merge 5.4 s (the scoped merge was never taken), body identity
carry over a commit 3.9 s (rebuilt bodies measured by volume), display 3.3 s (ids not one block per body, so the whole-model path), plus the reply. Causes:
1. The boolean was given the whole model as one argument: it rebuilt about 10 bodies (touching bodies get joined faces) although the tool reached 1 to 3, so the changed set was large
   and the bodies shared faces, edges and vertices, which turns off the scoped merge and the per-body display. Now `shared/bodycut.py` cuts each body the tool's box reaches on its own (the others stay the very same shapes, each cut gets its own copy of the tool).
2. `mergescope.changed_between` compared bodies by position and gave up when the count changed; a boolean lists bodies in another order and a cut may split one. It now matches by identity (count may differ).
3. A cut's merge always changes the cut bodies, so `merged` never became true after a hole. `settled_beside`: the merge left the bodies the operation did not change as they were (face, edge, vertex counts per body), which lets the next operation be scoped.
Timings (same script, same machine, other agent running): hole 1 in a settled model 16.4 s to 5.0 s (the first scoped merge 2.0 s of it), later holes 18 s to 0.9-1.1 s (execute 0.35, commit 0.05, display 0.3, reply 0.45).
Before the first four whole-model merges (right after import) a hole is unchanged (31 s, 13 s, 13 s): the model has to settle first, as for moves.
A hole that cuts 118 bodies (a through hole in the middle of the enclosure) still takes about 45 s: every body is rebuilt, nothing to scope. Not looked at further.
Not checked in the browser (task 1 is core only). The result has the same bodies and geometry; what can differ from the whole-model boolean is that touching bodies no longer hold one joined face where they meet (face ids and counts can differ by a few).
Guard tests: `tests/test_bodycut.py`, `tests/test_merge_scope_tools.py` (hole in other bodies equals the whole-model result; second hole is merged scoped; changed_between order and split).
