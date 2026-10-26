# Agent notes: model (branch agent/model)

## Per row

- Unify, Patch fill, Bridge, Path array not findable: DONE. They were in the All tools list under other labels (Unify is "Refine bodies"); search ignored underscores and had no id keywords. Search now maps "_" to a space and the four tools have keywords; tooltips say what they need. Delete the row.
- Revolve face and Sweep with Ctrl+click: DONE. Cause: adding an item of a different kind replaced the selection. Faces and edges may now be mixed. Delete the row.
- Resize fillet on a chain: DONE (core test). Chain = same-radius fillet faces tangent-connected to the picked one; variable end radius refused on chains. Delete the row.
- Round face edges gizmo, Divide face (gizmo, angle, grid), Move hole/boss gizmo, Circular array (angle and count grips, axis list with Picked edge, Pick axis edge button): DONE. Divide face: params angle, columns, rows (0 = off); the offset grip shows for a single line only. Delete the four rows (Circular array: both items done; "any axis" = X, Y, Z in the list plus a picked edge).
- Arrays on selected features: DONE, provisional (selecting only full hole or boss walls copies the features, not the body). Delete the row.
- Distribute holes/bosses is unclear: ANSWERED, row stays. Today it sorts the selected holes by their coordinate along the chosen axis and spaces them evenly between the two outermost, changing only that coordinate. The four bracket base holes form a 2 x 2 grid, so with axis X the two holes of each column are pulled to different X values (1/3 and 2/3 of the span), which looks wrong. Proposal: keep it for holes in one row only and refuse (or group) grids; or drop it once arrays on features exist. Only the tooltip changed.
- Export mesh tessellation: DONE. Defaults 0.003 mm and 0.5 rad, copied from the slicer's public source (see decisions-log.md for the files). Angle is in radians as in the slicer's dialog (provisional). Delete the row.
- More import and export types: DONE for .step, .stp, .stpZ, .iges, .igs, .brep, .brp (round-trip tests). NOT built: .ifc (no kernel reader; IfcOpenShell is LGPL-3.0 and 42 to 55 MB per platform) and .3dm (rhino3dm, MIT, about 2.5 MB; needs our own trim conversion). The row stays for IFC and 3dm.
- First hand-test pass: CHECKED. Already fixed before: Open STEP now has Import (add) and Open as new with a confirm when there are edits; Export STEP uses the browser's save dialog; Delete face is named Defeature and gives failure messages; Align face has a tooltip saying what it needs. Fixed now: the face helper "Edge loops" is "Outline edges". Not reproduced or needing design, row stays: click and shift select, chips, "Double-click chain adds non-tangent edges" (core check is at 1e-6, so not a core bug), measurements stopping, M mode, Push/pull on a hole face (a drag on a cylinder wall starts a box select because it has no push direction).
- Quick two-distance chamfer: PARKED (discuss). Alt clashes with Alt+click face cycling and Tab with typed entry. The two-distance tool needs a reference face, which a plain edge chamfer does not have. Proposal: a "Two distances" button in the Fillet/Chamfer form that reopens as Chamfer (two distances) with the first face beside the edge as reference.
- Mirror from bodies list with planes and Pick plane: DONE, provisional (see decisions-log.md). Delete the row.
- Cut with plane: PARTLY DONE. Remove side list (None, Side 1, Side 2), Pick plane (flat face) and datum buttons, gizmo already existed. Not built: side names coloured like the result bodies, picking a kept sketch plane. Answer to the owner's question: Split with plane and Cut with plane were merged in effect (None keeps both); the old split tool is still registered but hidden. Row stays for the two parts.
- What is Chamfer (distance and angle): ANSWERED. The bevel starts the distance in from the edge along the selected face and slopes away at the angle to that face (45 = equal legs). Tooltip rewritten. Ask the owner whether to keep it. Row stays until answered.
- Remove fillet/chamfer vs Defeature and Fill hole vs Defeature: CHECKED. Defeature gives the same volume on every fillet and round hole face of the bracket (core test). Boss and chamfer cases are covered by the existing tests of the older tools only. No tool removed. Rows stay for the owner's decision.
- Inset face ball selector (discuss): not touched; no change before the owner decides. Suggestion: reuse the toggle handle (click marker) for other on/off options, as Chamfer (two distances) already does for Swap.
- Split manipulator.ts: DONE as a pure move of the camera-free maths and constants into app/src/handlemath.ts (re-exported). The class (arrows, grid grips, turn arcs) is still one file of about 600 lines; a further split of the turn arcs needs the class state shared, so it was not done. Delete the Planned row only if this is enough.

## Decisions taken (all in docs/decisions-log.md, hand-test lines in docs/testing-checklist.md)

Arrays on features; Mirror planes and bodies; Cut with plane sides and plane picking; radians for export angle; Outline edges rename; search "_" handling.

## Questions for the owner

- Should the export mesh angle be in degrees instead of radians? Default: radians, as the slicer's dialog.
- Should Distribute holes/bosses be kept for single rows and refuse grids, or be removed in favour of arrays on features? Default: keep, tooltip only.
- Should IFC (IfcOpenShell, large dependency) and .3dm (rhino3dm, own trim conversion) be built? Default: not built.
- Which key should switch a chamfer being created to two distances (Alt clashes with Alt+click, Tab with typed entry)? Default: a form button, not built yet.
- Should Remove fillet/chamfer and Fill hole / remove boss be removed now that Defeature matches them? Default: keep both.

## Resume point

All queued rows are done or parked above. The sketch agent also edits app/package.json (the test list) and main.ts; expect small conflicts at merge. Servers and tab were stopped.
