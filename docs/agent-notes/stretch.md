# Agent notes: non-uniform scale and push/pull copy

## Push/pull Copy (done)
- Card button "Copy" (off by default, resets when the card closes, like Flip). The core reads `copy` in `tools/push_pull.py` (`_run_as_copy`).
- With Copy on, the bodies that own the selected faces stay as they are; the changed bodies are added after them as new bodies. The change is made on those bodies alone, so Other bodies is not merged into or cut. A loose sketch region ignores Copy.

## Owner questions
- (see end of run)
