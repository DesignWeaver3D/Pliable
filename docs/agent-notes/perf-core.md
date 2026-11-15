# perf-core notes

Enclosure as imported (114 bodies, 120 listed), `others` interaction, 2 mm hole 5 mm deep, scripts in C:\dev\pliable-wt\perf\ (ph_seq.py, pc2_first.py).

## Hole right after an import

Before: 35 s (11 s waiting for the import merge), then 11 s, 11 s.
Causes: the imported model is compounds inside compounds, so the one-body-at-a-time cut fell back to the whole model, which reordered the bodies and made the import merge memory unusable; every commit worked out the volumes of all 120 bodies twice in body identity matching.
Changes: `bodycut._plain_bodies` accepts grouped compounds (order of `solids_of`); `mergescope.finish_scoped` takes the merge memory (`merge_remembering`) when the model is not yet known merged; `bodies._known_volume` remembers volumes by body identity.
After: 19 s (11 s waiting for the import merge), 8 s, 6 s.
