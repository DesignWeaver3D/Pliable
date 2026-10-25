# Hand-testing checklist

Mark each line `[w]` works, `[r]` rough (usable, but note why), or `[x]` broken. Put a short note after the dash. Tool ids match `app/src/layout.ts`; `divide_face` and `inset_face` are registered but not placed in a group, so they show under "Other".

For every tool, check these five things once, then only note the exceptions:
1. Selecting the right thing enables the tool (and the wrong thing doesn't).
2. The live preview matches the result.
3. Typed entry (Tab) gives the same result as dragging.
4. Undo and redo restore the exact model.
5. The status message makes sense, including on an invalid input.

Test on: a simple block, a part with holes (the bracket), and an imported STEP file.

## File, view and selection
- [r] Open STEP- does not warn that current model will be deleted. Does not offer option to add to current session (mulitple solids).
- [r] Export STEP - does not provide dialog to define export name or file type or destination.
- [x] Export STL / OBJ / 3MF - I don't see this tool or functionality at all.
- [r] Combine STEP (other file at its own origin) - see open step above. Maybe the options should just be import or exxport and work from there.
- [w] Undo / redo across several different tools
- [r] Click select: face, edge, vertex; shift/ctrl multi-select - unclear what shift select does. Appears to create selection chips but then don't know what to do next. Sometimes hard to select edges. hard to select small faces without zooming way in.
- [r] Double-click an edge selects its smooth chain; ctrl+double-click adds - sometimes adds non-tangent edges which is wrong. Ctrl+doubleclick doesn't behave as expected.
- [r] Related-face chips (coplanar, equal radius, coaxial): toggle on/off, highlight is correct - highlight appears correct but unknown how to work with chips altogether.
- [r] "All edges" and "Edge loops" for a selected face - both appear to do same thing. Edge loop should be the outperimeter edges, or have a different name perhaps.
- [w] Number keys for standard views (0 to 6), `P` perspective/orthographic toggle
- [w] Orthographic camera looks right when rotated and zoomed
- [r] Measurements shown for a selected edge, hole wall, flat face, fillet face, vertex - this seems to work good, but sometimes after other tool usage stops working and need to refresh the browser tab to get it working again.

## Edit faces
- [r] push_pull — flat face out and in; hole wall; onto another body (merge) - push/pull flat face works pretty good, but M mode is regression that doesn't work when right-click mode did (can't use right click because need right-drag for orbit?). Push/pull hole face does nothing at all, starts a box selection.
- [r] delete_face — heals the gap; fails clearly when it cannot - works on circular holes. fails otherwise with no error or message why. This was supposed to be named Defeature. Delete face doesn't make sense in all the contexts that this is supposed to work.
- [x] align_face - this is grayed out and i have no idea what it's supposed to do anyway.
- [x] draft - doesn't appear to work at all.
- [ ] round_face
- [ ] divide_face (under "Other")
- [ ] inset_face (under "Other")

## Edges
- [ ] fillet_chamfer — drag a single edge and a chain
- [ ] resize_fillet — constant radius, variable radius, constant/variable switch
- [ ] resize_chamfer
- [ ] variable_fillet
- [ ] chamfer_two_distances
- [ ] chamfer_distance_angle
- [ ] remove_round

## Holes
- [ ] add_hole
- [ ] add_counterbore
- [ ] add_countersink
- [ ] add_slot
- [ ] add_boss
- [ ] resize_hole — with equal-radius rule on and off
- [ ] move_hole — one hole alone (default) and all equal-radius holes together
- [ ] center_between — hole, then two faces; also other pick orders
- [ ] align_holes
- [ ] distribute_holes
- [ ] pattern_hole
- [ ] pattern_hole_circular
- [ ] fill_hole
- [ ] Hole centre measurements: centre, centre-to-centre, centre-to-face

## Solids
- [ ] add_box
- [ ] add_cylinder
- [ ] add_sphere
- [ ] add_cone
- [ ] add_torus
- [ ] add_prism
- [ ] linear_array
- [ ] circular_array
- [ ] path_array — over connected edges
- [ ] revolve_face
- [ ] loft_faces
- [ ] sweep_face
- [ ] body_boolean — union, subtract, intersect
- [ ] shell
- [ ] mirror
- [ ] unify
- [ ] patch_fill
- [ ] bridge
- [ ] offset_body
- [ ] cut_plane
- [ ] split_plane

## Transform body
- [ ] move_body
- [ ] rotate_body
- [ ] scale_body

## Sketching
- [ ] Sketch on a selected flat face
- [ ] Sketch on XY, XZ, YZ, and on a plane moved by an offset distance
- [ ] Line (auto horizontal/vertical snap within 3 degrees)
- [ ] Rectangle (square, rounded, bevelled corners)
- [ ] Centre rectangle
- [ ] Circle
- [ ] Arc
- [ ] Offset curve
- [ ] Trim and extend
- [ ] Point snapping to curves and midpoints, alignment guides
- [ ] Live size tags while placing shapes
- [ ] Project model edges onto the sketch plane
- [ ] Select and drag sketch points
- [ ] Constraints and dimensions
- [ ] Finish sketch: regions become faces; zones on a flat face are imprinted
- [ ] Discard sketch (button and Escape)
- [ ] Extrude or push/pull a finished sketch region

## Tool GUI
- [ ] Every tool button opens, runs, and closes cleanly
- [ ] Tools without a drag parameter open a typed-value form with live preview
- [ ] Top bar wraps on a narrow window
- [ ] Edit last works until another change is made

## Notes
Anything not tied to one tool (crashes, lag on large parts, confusing messages) goes here:

## Added 2026-10-18 (merged since the first checklist)

- [ ] Alpha notice shows on a first launch, not again after I understand and a reload
- [ ] Restore prompt: kill the core, restart it, the previous model is offered once; two copies running at once never offer or touch each other's session
- [ ] Tooltips: every tool in the list, the strip and Ctrl+K says what it does and what it needs; main bar, sketch panel, settings and Keys buttons have tooltips
- [ ] Box select, window (left to right): only items fully inside; crossing (right to left): everything touched; Box selects kind switch in settings
- [ ] Alt+click cycles through the faces under the pointer, with see-through off and on
- [ ] Edge ring, Edge loops and Sharp edges with one edge selected: result highlighted, tooltip explains each; sharp-edge angle slider
- [ ] Inset face edges: outer loop and loop 1 on a face with holes (face count goes up)
- [ ] Divide face: typed form, and placing the divide edge by dragging in the view
- [ ] Fillet per edge on all top-face edges: 0 open edges after applying
- [ ] Add box creates its own body; Move body, Rotate body, Scale body and Offset body act on the selected body only; a group of faces from two bodies moves both; nothing selected moves everything
- [ ] Boolean joins two bodies into one solid
- [ ] Emboss/Cut along surface on a cylinder face and on a wrapped sketch region; unrolled sketch plane sits beside the model
- [ ] Unrolled sketch: cone (not a pointed cone), a chain of flat, fillet and flat faces, a region across the seam of a closed cylinder
- [ ] Sketch: a free line and circle drag by their body without anything else moving; tangent arc and line; snap to an in-plane axis line
- [ ] Hole centre dots: they show on every hole all the time (known); dragging one moves the hole
- [ ] Per-tool applies-to chip: Resize hole also resizes same-size holes by default, other tools only the selected feature
- [ ] Unsaved-work warning when leaving the page with edits or an open sketch
- [ ] Keys window lists the see-through key (X) and the sketch keys; keys act only while the pointer is over the view

## Per alpha build

- [ ] Packaged build: unzip, run, open the bracket, push/pull, export STEP (or confirm CI is green)
- [ ] A long open shows the busy indicator and the UI stays responsive; it clears after a failed operation too
- [ ] Copy diagnostics shows its text first and contains nothing personal
