# Questions for the owner

Only real questions that need your answer. Each one ends with a question mark and gives two sentences of context, the options, and what I will do if you do not answer. Decisions already made live in docs/decisions-log.md; plan changes live in docs/progress.md.

## Open questions

Research on selection filters, editing dimensions in place, discoverability and sketch placement is still running; more questions will be added when those reports are in.

### Holes (S48; research is in docs/research/holes-scope.md)

1. **Round holes only at first?** Other direct modelers recognise only round holes as holes and treat slots and polygon cuts as pockets or slots. Options: (a) round holes only now, obround slots later; (b) include obround slots now; (c) try to treat every through-cut as a hole. Default if unanswered: (a).

2. **Should dragging the far end of the hole axis change the hole depth?** The axis would show on hover or selection with the middle as a move handle, and the far end sets depth with through as a snap point. Options: (a) yes; (b) show the axis line only, and change depth in a form; (c) centre point only. Default if unanswered: (a).

3. **Should the hole centre also become a separate pick target, only for measuring, snapping and dimension anchors?** Today the centre dot is an alias for the hole face, and picking a rim edge will expose the circle's centre as you asked. Options: (a) yes, a separate pick kind for anchors only; (b) keep it an alias for the face. Default if unanswered: (a).

4. **Should an existing hole be convertible to a countersink, with diameter and included angle, while the edge chamfer stays a separate tool?** A chamfer is a symmetric edge break; a countersink is defined by diameter and angle so a flat-head screw sits flush. Options: (a) add convert-to-countersink; (b) chamfer only. Default if unanswered: (a).

## Topics you asked to discuss one at a time

These are not questions yet; I will turn each into specific questions when you pick it: keyboard shortcuts (which modifier combinations, which keys are reserved and why, where the pointer must be), the sketch keys, and the unsaved-work warning.
