# Sketch ellipse and circle dragging (agent notes)

Done (tests: pytest 537, npm test 283, tsc and build clean):
- Ellipse live construction lines: the solver's "keep unconnected geometry still" step did not count an ellipse's major2/minor1/minor2 ends as connected, so they stayed put during a drag and jumped on release. Fixed in core/src/pliable/sketch/solver.py (_connected_ids).
- Ellipse move lag: a body drag pinned all five ellipse points (10 coordinates) although the ellipse's own constraints fix most of them; the solver rebuilt and retried about 7 times (about 120 ms per frame). Now an ellipse is held by its centre and major end only (about 3 ms).
- Circle: a circle that no constraint mentions is resized by dragging its rim (centre fixed, radius = distance to pointer, applied locally, solved on release). Its centre point still moves it. Circles with a dimension or relation on them still move as a whole (decision: "unconstrained" means no constraint lists the circle). Code in app/src/sketchcircledrag.ts.

Needs a human: real-mouse feel of the rim resize and the ellipse drag. Not checked in Chrome by the agent.
Behavior change vs before: dragging a free circle's rim used to move it; now it resizes (owner's request). Add to behavior.md when approved.
