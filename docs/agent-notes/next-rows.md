# Agent notes: candidate next rows (survey)

Checked against the code and docs/behavior.md. Already built, so not listed: view-plane sketch, select similar, auto-removal warning, Edit last button, align face and holes, up-to push/pull, flip tests (core/tests/test_sketch_flip.py).

Join open points: (1) mixed curves into a spline needs an owner decision; (2) the junction change is inherent to one spline through the points; (3) "button only" matches the hotkey rules in behavior.md (bare keys only for core, frequent tasks). None is a small row; none listed.

1. Repeat-last-tool key. A key that runs the newest tool again with its values (Edit last only reopens the form). Why: frequent in arrays, holes, fillets. Files: app/src/keys.ts, keyrouter.ts, a new small module, appstate.ts. Needs Ctrl or Alt (behavior.md Keys); default is redefinable. Source: progress.md Ideas, tool workflow item 5; research/shortcut-policy.md. 1-2 commits.
2. Sketch solver scenario set. Tests that every solver change must keep solving without flips: dimensioned rectangle, slot, tangent chain, symmetric profile, ellipse in a rectangle, spline through points (extend the flip tests). Why: guards the owner's regressions. Files: core/tests/test_sketch_scenarios.py (new), maybe app/tests. Source: research sketcher parity note "Parity test approach". 1 commit.
3. Blind hole depth grip (check first). Drag the far end of a plain blind hole to set depth, through as a snap. Behavior.md only records grips for counterbore and countersink steps; confirm no depth grip exists in the viewport, then build. Files: app/src/holeeditor.ts, holepoints.ts, a new grip module; core/src/pliable/tools/edit_hole.py unchanged. Source: research/holes-scope.md, first complete version item 4. 2-3 commits.
4. Fillet order warning. When a large radius is applied beside a smaller one on the same corner or a fillet fails, say which edges and why in the status line. Files: core/src/pliable/tools/fillet_chamfer.py, fillet_per_edge.py, app/src/ form status. Source: progress.md Ideas, tool workflow item 10. 1-2 commits. Weakest candidate: the exact trigger needs a core experiment.
5. Failure cue on the model. Highlight the faces or edges the kernel names when an operation fails, beside the red status. Files: core/src/pliable/opserrors.py, ops.py, app/src/viewport highlight module (new file). Source: progress.md Ideas, tool workflow item 7. 3-4 commits; the kernel may not name faces for every failure, so test first.

Only 5 qualify, and 3 to 5 are less certain than 1 and 2.
