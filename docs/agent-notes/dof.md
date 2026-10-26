# Degrees of freedom and fully constrained colouring

Status: both rows addressed; not removed from progress.md (not my file).

Causes found
- The freedom reply solved the whole sketch for every point inside a 1 second limit. With about 40 or more points in separate shapes, points were left out; they were then neither green nor lit, and the message said the freedom was "in a size". Now each connected part is tested alone (core/src/pliable/sketch/freedomparts.py), so 60 squares answer in 0.3 s. If points are still missed, the message says how many could not be checked.
- A circle (or ellipse without axis ends) with a free size was not lit; now it lights yellow. Ellipses without axis ends (old files) report a free size until a minor radius dimension exists (projected ones are references and excluded).
- Checked and fine: dimensioned rectangle, slot, circle tangent chains, symmetric rectangle, ellipse with axis ends, fixed spline.

Not changed
- Old-format ellipse minor size is not counted in the dof number (solver does not hold it).
- "1 degrees" wording left as is.

Human-only checks
- A real sketch with 20+ separate shapes: the message highlight lights the open ones and nothing is skipped.
