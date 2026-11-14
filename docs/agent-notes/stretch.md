# Stretch agent notes (branch agent/stretch)

## Done so far
- New package `core/src/pliable/stretch/` (not yet used by `tools/stretch.py`):
  - `body.py` numbered faces/edges/vertices of one solid; `zones.py` protected / rubber / fixed from the selection (end fillets tangent to a protected face ride with it);
  - `band.py` direction (area-weighted normal of the protected faces), band end, limit, island features, Auto start, typed length with riders;
  - `falloff.py` share of the move per level (linear, G1 cubic, G2 quintic; constant across riders); `field.py` the deformation (straight re-fit or smooth bend) and the rigid `Move`;
  - `fit.py` cubic spline fits with knots at the band levels; `recognize.py` plane / cylinder / cone recognition; `deform.py` new geometry per face, edge, vertex; `rebuild.py` same-topology rebuild (ids kept).
- Scratch experiments (not tests yet) give valid solids: block lengthen and shear (planes), bar with a middle hole (only the part past the hole stretches, exact volume), widened band with the hole riding, cylinder and cone along the axis (stay cylinder / cone), filleted box end, tilt, smooth shear (free-form faces).

## Decisions (to log in docs/decisions-log.md when the tool is wired)
- A straight ramp is used when it leaves no new crease (planes stay planes, old taper and shear results kept); the G1/G2 easing is used only where a crease would appear.
- End fillets tangent to a protected face move with it; an island feature level with the protected part joins it.
- Tilt pivot default: center of the protected part.

## Resume point
1. Wire `tools/stretch.py` mode 0 to the package (layout -> band.start -> Falloff -> Field -> Deformer -> rebuild -> validity -> face merge with tracked faces); keep mode 1 and the insert fallback; keep `stretch_solid` / `shift_vertices` for `move_edge.py`.
2. Add: choice between straight and smooth field (crease test), fold check, shortening with defeaturing (`shorten.py`), frame / tilt / pivot params (`frame.py`), band handle, notice for free-form faces.
3. Tests through `Tool.execute`, watchlist entries, decisions log, then the app.
