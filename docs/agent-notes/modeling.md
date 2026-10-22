# Modeling agent notes (branch agent/modeling)

All five sessions done in order S107, S108, S109, S110, S111 (order unchanged).

## Not checked in the app
The coordinator said Chrome was not ready, so nothing below was checked in the browser; all checks are unit tests (Session.handle / Tool.execute), tsc, npm test and the build. Per task:
- S107 rings: not checked in the app (math tested via refitRing). Interpretation: ring diameter = 50% of the view's short side.
- S108 project file: Save project / Open project menu buttons and command search entries not checked in the app.
- S109 datum planes: list under Sketches, drawn squares, command search entries not checked in the app.
- S110 Shift symmetric push/pull: the viewport change (Shift+press on a face starts the drag) and the front end request are not checked in the app. Possible gap: the front end's own check of which tool applies to a selection of two opposite faces was not examined; if Shift-dragging two opposite faces does nothing, look at dragToolFor / acceptsSelection in main.ts.
- S111 mirror mode: command search entries, status line and orange outline not checked in the app.

## Decisions
See docs/decisions-log.md (datum planes, symmetric push/pull, mirror mode) and docs/watchlist.md.
- .plbl: zip with project.json (kind, format 1, name, objects map) + model.brep; unknown object types are kept. Autosave state files are now state_N.plbl (session.json format 2); format 1 sessions still restore.
- Commits carry no attribution trailer, following the project rules file.

## Open
- A project file holds only the current state (no undo history).
- Datum planes are drawn as a fixed 120-unit square.
