# Agent notes: non-uniform scale and push/pull copy

## Push/pull Copy (done)
- Card button "Copy" (off by default, resets when the card closes, like Flip). The core reads `copy` in `tools/push_pull.py` (`_run_as_copy`).
- With Copy on, the bodies that own the selected faces stay as they are; the changed bodies are added after them as new bodies. The change is made on those bodies alone, so Other bodies is not merged into or cut. A loose sketch region ignores Copy.

## Owner questions
- (see end of run)

## Non-uniform scale (done)
- Scale body params: factor (X, or the one factor), scaling (Uniform default / Non-uniform), factor_y, factor_z. World axes, same center as before. The form hides Y and Z while Uniform. A single factor still works. No drag handle in Non-uniform mode.
- Uneven scaling rebuilds surfaces as splines (a cylinder becomes an elliptical spline solid); editable primitives lose their recipe (as for other non-rigid changes).

## Owner questions
1. Push/pull Copy with "Other bodies": Copy changes only the owning body (other bodies never merged or cut). Option: let Other bodies still merge/cut with the copy. Default: as built.
2. Non-uniform scale drag handle: none (typed factors). Default: as built.
