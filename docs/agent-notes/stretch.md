# Other-bodies cuts, tool by tool (agent/stretch)

Each tool cuts the bodies it reaches one at a time (`shared/bodycut.py`) and merges with `mergescope.finish_scoped`, as Add hole does.
Times are `tool_commit` on the owner's enclosure (120 bodies) after three moves, "Other bodies".

| Tool | Status | Enclosure before / after |
| --- | --- | --- |
| Slot | done (through-depth measure kept: the whole-model bounds cost 14 ms) | 62.7 s (229 bodies) / 1.1 s (120 bodies) |
| Push (subtract) with Other bodies | done: the cutting volume of a push is cut out of each body that does not own the pushed face, one at a time (`pushpull.py`, `bodycut.cut_each`); each cut body is merged on its own, no whole-model merge added | 0.9 s / 0.8 s (the enclosure face reaches no other body) |
| Revolve Subtract | done: cut body by body, scoped merge, volume change measured on the changed bodies only, loose faces found by a face map (the per-face search of every body took about 80 s on the enclosure). The audit's other-body failures for Revolve were a test-scene artifact (the swept face straddled the line nearest the axis, so the sweep overlapped itself and was no valid solid); the scene is moved and one post overlaps another. Revolve Add with Other bodies still fails (join tools, later row) | over 300 s (stopped) / 0.9 s (the same call before the loose-face fix and with the new cut: 94.7 s) |
| Sweep (subtract) | pending | |
| Helical sweep (subtract) | pending | |
| Hole to slot | pending | |

Resume point: Sweep (subtract).
