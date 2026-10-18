# Kernel agent notes (S22, S23, S24, S25, S37)

## S22 - Done (Tier 1 all built; thicken surface parked earlier, see parity-plan Parked table)
## S23 - Done/parked
Built earlier: variable fillet, loft, sweep, array along path, offset curve, construction planes at offset, polygons/trim/extend.
Parked this run (decision, no owner): ellipse/spline sketch curves (py-slvs has no ellipse/spline, belongs to the sketch agent), project curves onto faces, groups/layers/colours (document model change). Measure between entities already exists (`measure.py` pair rows).
## S24 - Done (built patch fill and bridge; fillet setbacks, G2, deform, T-spline parked in parity-plan).
## S25 - Done as far as possible without the owner
Added `core/tests/test_seams.py`: out-and-back push/pull, boss+fill, hole+fill, fillet/chamfer+remove round, union+subtract, all with face/edge count equality and a no-mergeable-seam check. A sweep of every one-face/one-edge tool on the bracket left no seams. Merge cost measured (0.4 s on 231 faces), logged in watchlist. Not reproducible; still needs the owner's exact model/steps; remaining suspicion is a stale hover/edge display line in the viewer (frontend, selection agent's area).
## S37
