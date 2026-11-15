# Other-bodies cuts, tool by tool (agent/stretch)

Each tool cuts the bodies it reaches one at a time (`shared/bodycut.py`) and merges with `mergescope.finish_scoped`, as Add hole does.
Times are `tool_commit` on the owner's enclosure (120 bodies) after three moves, "Other bodies".

| Tool | Status | Enclosure before / after |
| --- | --- | --- |
| Slot | done (through-depth measure kept: the whole-model bounds cost 14 ms) | 62.7 s (229 bodies) / 1.1 s (120 bodies) |
| Push (subtract) with Other bodies | pending | |
| Revolve Subtract | pending | |
| Sweep (subtract) | pending | |
| Helical sweep (subtract) | pending | |
| Hole to slot | pending | |

Resume point: Push with Other bodies.
