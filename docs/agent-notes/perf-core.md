# perf-core notes (agent/perf-core)

## Typed arc direction
The committed typed arc is always counterclockwise (`addArc` is called with `placingTyped`; behavior.md: "A typed sweep in degrees is always counterclockwise"),
and `sketchpreview.ts` already drew it that way (`positiveSweep`). The odd one out was the angle dimension drawn by `sketchtypeddims.ts`: it went clockwise at
exactly 180 degrees (`turnShortWay` gives -pi) and followed the pointer's side above 180. It now uses `positiveSweep(turnShortWay(..))` and the typed degrees as they are.
Test: `app/tests/sketchpreview.test.mjs` (90, 180, 270 degrees, pointer on either side).
