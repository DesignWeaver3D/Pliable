# Questions for the owner

Only real questions that need your answer. Each one ends with a question mark and gives two sentences of context, the options, and what I will do if you do not answer. Decisions already made live in docs/decisions-log.md; plan changes live in docs/progress.md.

## Open questions

All current research is in; questions follow below.

### Holes (S48; research is in docs/research/holes-scope.md)

1. **Round holes only at first?** Other direct modelers recognise only round holes as holes and treat slots and polygon cuts as pockets or slots. Options: (a) round holes only now, obround slots later; (b) include obround slots now; (c) try to treat every through-cut as a hole. Default if unanswered: (a).

2. **Should dragging the far end of the hole axis change the hole depth?** The axis would show on hover or selection with the middle as a move handle, and the far end sets depth with through as a snap point. Options: (a) yes; (b) show the axis line only, and change depth in a form; (c) centre point only. Default if unanswered: (a).

3. **Should the hole centre also become a separate pick target, only for measuring, snapping and dimension anchors?** Today the centre dot is an alias for the hole face, and picking a rim edge will expose the circle's centre as you asked. Options: (a) yes, a separate pick kind for anchors only; (b) keep it an alias for the face. Default if unanswered: (a).

4. **Should an existing hole be convertible to a countersink, with diameter and included angle, while the edge chamfer stays a separate tool?** A chamfer is a symmetric edge break; a countersink is defined by diameter and angle so a flat-head screw sits flush. Options: (a) add convert-to-countersink; (b) chamfer only. Default if unanswered: (a).

### Dimensions, selection filters and hints (S55, S56, S57; research is in docs/research/interaction-patterns.md)

5. **When you edit a face-to-face distance in place, should the face you clicked last move while the other stays fixed?** A small flip control beside the field would swap which face moves. Options: (a) last-clicked face moves, with a flip control; (b) always the larger body stays fixed; (c) always ask. Default if unanswered: (a).

6. **For choosing what a selection picks, do you want a held key during the box drag (for example F for faces, E for edges, V for vertices), a visible kind badge with a one-click reset, and a right-click Select similar, without a filter toolbar for now?** The alternatives are a persistent filter toolbar, or filtering only after the selection. Options: (a) the held key, badge and right-click Select similar; (b) add a filter toolbar as well; (c) only filter after selecting. Default if unanswered: (a).

7. **Which key removes an item from a selection?** The drafting program you use removes with a modifier on click, other tools toggle with Ctrl. Options: (a) Shift adds and Ctrl toggles; (b) the drafting convention where a modifier removes; (c) both work. Default if unanswered: (a), with removal also on Alt only if it does not collide with Alt+click cycling.

8. **Is a one-time dismissible hint the first time a hidden mode becomes available acceptable, with a setting to turn all hints off?** It is how the measure pick and see-through would be found without reading documentation. Options: (a) yes; (b) never interrupt, use the always-visible hint line only. Default if unanswered: (a).

### Sketching (S43-S45; research is in docs/research/sketch-placement.md)

9. **Should ellipses and splines get only endpoint constraints in the first version, or must their shape (axes, control points) be dimensionable?** The current solver has neither curve, so the cheap route is our own ellipse and spline entities whose ends can be constrained but whose shapes cannot; full shape constraints would mean replacing the solver. Options: (a) endpoint constraints only now; (b) replace the solver for full constraints. Default if unanswered: (a).

10. **Should projected edges and points be one-off snapshots, or update when the model changes?** The app keeps no history, and the face outline already works as fixed reference geometry. Options: (a) snapshot, fixed in the sketch; (b) live links that follow the model. Default if unanswered: (a).

11. **After a face, the principal planes and the view plane, which ways of placing a sketch matter most to you?** Each is a plane built from a different input. Options, in my suggested order: plane through three points; plane from an edge and a point; offset or angled plane from a face; plane normal to a curve; plane tangent to a surface at a picked point. Default if unanswered: that order.

12. **Should sketch tools add constraints on their own?** Today a rectangle adds horizontal and vertical constraints, lines snap to horizontal or vertical within 3 degrees, and snapping onto a curve or midpoint adds a point-on or midpoint constraint. The sketch agent could not reproduce geometry failing to float freely when dragged, and suspects these automatic constraints, so a rectangle or a snapped line is never really unconstrained. Options: (a) keep them but show each one clearly and make it removable with one click; (b) never add any automatically, you add constraints yourself; (c) keep as it is. If you can, tell me the exact steps where geometry did not float. Default if unanswered: (a).

13. **Should a finished sketch be kept as an object you can reopen, or stay a one-way step that only leaves faces?** The model has no history, so a kept sketch would need its own place in undo, autosave and saved files, and a rule for what happens to the faces it made when you edit it. Options: (a) keep sketches as they are, one-way; (b) keep each sketch as a named item that can be reopened and re-finished, replacing the faces it made; (c) keep only a copy you can reuse as a starting point for a new sketch. Default if unanswered: (a).

14. **Do ellipses and splines need full shape constraints (axes, control points, tangent and equal links to other shapes), or is the current limit enough?** Today you can place their points and dimension an ellipse's short radius, but not tie their shape to other geometry. Full constraints need a different solver, and the one candidate has no macOS build, so the cost is real. Options: (a) accept the limit; (b) switch solvers and carry the packaging cost. Default if unanswered: (a).

15. **Should sketch dimensions accept named values and formulas?** Typing a name or a formula such as width / 2 in a dimension would let one value drive several, but it is a history-style feature that sits oddly with direct modeling. Options: (a) numbers only; (b) named values and formulas in sketch dimensions only. Default if unanswered: (a).

## Topics you asked to discuss one at a time

These are not questions yet; I will turn each into specific questions when you pick it: keyboard shortcuts (which modifier combinations, which keys are reserved and why, where the pointer must be), the sketch keys, and the unsaved-work warning.
