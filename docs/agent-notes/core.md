# Core agent notes

## Compound body (union of non-overlapping bodies)
- A body is now a solid or a CompSolid (several solids in one body). `ops.solids_of` returns one entry per body, so BodyState stays parallel to it and no caller changed. `ops.group` builds a CompSolid; `ops.keep_compound` (run in `Tool.execute`) and `ops.regroup` (push/pull per-body path) re-group results when an operation returns a plain compound.
- Body Boolean Union groups its result. Limits: with several bodies, tools other than push/pull that rebuild a body from a boolean may split a compound body back into separate bodies; Subtract/Intersect do not group; `combine_step`/Combine-with-file union is unchanged; per-solid measure of a compound body reports the whole body.
