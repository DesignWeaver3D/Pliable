# Modeling agent notes (branch agent/modeling)

## Status
- S107 done (rings: diameter = 50% of the view's short side, trial reading of "50%").
- S108 in progress/done: see commits.

## Decisions
- Project file `.plbl` is a zip: project.json (kind, format, name, objects map) + model.brep. Unknown object types are kept in `Document.other_objects`.
- Autosave states are now `state_N.plbl` (session.json format 2); format 1 sessions still restore.
- Chrome tools were not available in this agent session, so no in-app checks were possible.
