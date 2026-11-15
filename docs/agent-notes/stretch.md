# Agent notes (stretch branch)

- Tasks 1 and 2 (import re-orients reversed solids; volume_of in the three push/pull and merge files): done.
- Task 3 phase 1 (arrays copy whole holes): done for linear, circular, concentric, path (all share `_fuse_copies`). `shared/hole_copy.py` builds the hole cut as the void of a cylinder around the hole's coaxial walls (widest radius + 1.5 mm) minus the model, so counterbore, countersink and thread groove copy exactly. Tests: `core/tests/test_array_hole_features.py` (linear and circular). Pattern hole / boss and Circular pattern buttons untouched (phase 2).
