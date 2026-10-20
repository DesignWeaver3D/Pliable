# Push/pull cut through

- Cause: the drag preview uses OCCT glue mode. When a cut reached or passed the far side of the solid, glue returned the solid unchanged and valid, so the preview jumped back to no change past the bottom (the exact commit was already correct).
- Fix (ops.py `_push_pull`): for a negative distance, a preview result that removed no volume is discarded and the exact boolean is used. A cut that removes the whole solid raises "That would cut away the whole solid; use a smaller distance" (before: an empty shape crashed the tessellator).
- Typed large values already work (-1000 gives the through pocket); no handle max exists and main.ts has no clamp. When a preview errors the drag keeps the last good distance (main.ts lines 565-570, 790), which is the desired behavior for the whole-solid case.
- Tests: test_core.py (boss, whole top, session), test_sketch.py (imprinted region).
