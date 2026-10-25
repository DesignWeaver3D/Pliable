kernel-b notes (branch agent/kernel-b)
- Zoom all: done (sketchfit.fitBoxOf, no 10-unit minimum).
- White viewport: cause NOT found. Not reproduced (two lines symmetric about a line; core fuzz of 1500 symmetric sketches, no NaN). Render loop now guarded per part (viewport.ts) with status error. three.js stops the loop after a throw; likely the cause. Restore-after-refresh: not investigated. Row stays open.
- New project stale geometry: open sketch stayed active; setCommitted(frame) now exits it. Not reproduced in app.
- Body volume/mass: done; mass uses Material setting (ABS default).
- Resize chamfer: first/second params + handles. Draft: Axis list + Pick axis; interpretation of "axis" to confirm.
- Chrome tab 929264735 (port 5204) stuck on a leave-site prompt (sketch open); could not close.
Not done: Project edges uses the real curve (waits for sketch-a).
