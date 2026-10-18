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
- [ ] Open STEP
- [ ] Export STEP
- [ ] Export STL / OBJ / 3MF
- [ ] Combine STEP (other file at its own origin)
- [ ] Undo / redo across several different tools
- [ ] Click select: face, edge, vertex; shift/ctrl multi-select
- [ ] Double-click an edge selects its smooth chain; ctrl+double-click adds
- [ ] Related-face chips (coplanar, equal radius, coaxial): toggle on/off, highlight is correct
- [ ] "All edges" and "Edge loops" for a selected face
- [ ] Number keys for standard views (0 to 6), `P` perspective/orthographic toggle
- [ ] Orthographic camera looks right when rotated and zoomed
- [ ] Measurements shown for a selected edge, hole wall, flat face, fillet face, vertex

## Edit faces
- [ ] push_pull — flat face out and in; hole wall; onto another body (merge)
- [ ] delete_face — heals the gap; fails clearly when it cannot
- [ ] align_face
- [ ] draft
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
