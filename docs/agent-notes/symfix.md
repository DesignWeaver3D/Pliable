# symfix notes

Cause: the app's ellipse centred on the origin has a fixed centre (p1 fixed, on the x-axis). The ellipse already makes its centre the middle of its minor ends, so "middle of the two points lies on the axis", one of the three parts Symmetric is built from, repeated the fixed centre and the solver called the whole constraint redundant. The "vertical axis" naming was right for the pick the app sent (axis id -2 for the vertical); in the reproduced x-axis case the warning says "horizontal axis". Centred elsewhere with a free centre, or rotated, it already worked.

Fix: when a Symmetric fails, the solver retries without the middle-on-the-line part, then without the square-to-the-line part, and keeps the result if the skipped part holds in the solution (core/src/pliable/sketch/solver.py, symmetry.py). Real conflicts (centre fixed off the axis, two ends of a line along the axis, wrong axis) are still refused with the usual warning.

Decision (hierarchy 2/3: other modelers accept a symmetric that only repeats something already implied): accept it silently instead of warning.

Checked in Chrome (5201/8801): reproduced the drop before the fix, applied after. Undo after applying was not confirmed on screen. Box selection of the two points cannot be done without also catching the ellipse, so shift-click selection was used.

Human check: with an ellipse at the origin, minor ends plus the x-axis, Symmetric applies; then drag the ellipse by a major end and confirm nothing jumps.
