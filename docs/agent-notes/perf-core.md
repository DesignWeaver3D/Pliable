# perf-core notes

Enclosure as imported (114 bodies, 120 listed), `others` interaction, 2 mm hole 5 mm deep, scripts in C:\dev\pliable-wt\perf\ (ph_seq.py, pc2_first.py).

## Hole right after an import

Before: 35 s (11 s waiting for the import merge), then 11 s, 11 s.
Causes: the imported model is compounds inside compounds, so the one-body-at-a-time cut fell back to the whole model, which reordered the bodies and made the import merge memory unusable; every commit worked out the volumes of all 120 bodies twice in body identity matching.
Changes: `bodycut._plain_bodies` accepts grouped compounds (order of `solids_of`); `mergescope.finish_scoped` takes the merge memory (`merge_remembering`) when the model is not yet known merged; `bodies._known_volume` remembers volumes by body identity.
After: 19 s (11 s waiting for the import merge), 8 s, 6 s.

## Through hole reaching many bodies (diameter 300, as imported, after the import merge finished)

Before: 24 s for the hole; after: 16 s (bodies cut 2 s, merge of the cut bodies 6.7 s of which the volume and area check of the same-surface step 4.3 s, body identity volumes 2.7 s, meshing the reply 4.4 s).
Not done (would change nothing visible but needs deeper work): the volume and area check in `samesurface.merge_same_surface` and the body-matching volumes are kernel integrations of 60-80 ms per body; mesh reply of the cut bodies could be done in parallel.
Differences from the old first-hole result (asked): surface body not joined into the host solid, body list order kept (old list put the cut bodies first), 82 versus 78 bodies for a 300 mm bore (surface remnants).
