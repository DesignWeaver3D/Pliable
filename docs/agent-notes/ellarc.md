# ellarc agent notes

Status: (1) Ellipse arc tool, (2) Split on an ellipse or elliptical arc, (3) projected tilted arcs and ellipse-edge parts as elliptical arcs: built and committed. (4) listed below.

Design: an elliptical arc is an `ellipse` entity with `start` and `end` point ids (counterclockwise). Core: `profiles._ellipse_edge` cuts the
edge by parameter; `solver._add_entity` holds both ends on the ellipse (foci construction, skipped for an axis end, built once per ellipse
frame so arcs cut from one ellipse share it); `solver._in_steps` solves distance and minor-radius changes in 8 steps when the sketch has an
elliptical arc (one jump stretched the ellipse). `planes.face_reference` returns `ellipse` entities with start and end (`drawn.ellipse_arcs`).
App: `sketchellipse.ts` (geometry), `addEllipseArc` in `sketchbuilders.ts`, tool `ellarc`, preview, typed sizes, `sketchsplitellipse.ts`.

Decisions (also in docs/decisions-log.md): five clicks (centre, long axis end, short radius point, start, end); the arc follows the pointer
direction from the start like the circular arc; typed sizes are major width, minor width and sweep (the arc starts at the long axis end);
a whole ellipse split once becomes one arc starting and ending at the cut.

Not done:
- Trim on an ellipse or elliptical arc (and on circles and circular arcs): the Trim tool still cuts lines only; the Split tool now handles ellipses.
- A typed sweep is not drawn as an angle dimension in the preview (the tag text is shown instead).
- Old ellipses without axis end points cannot be split (refused with a message).
- Projected elliptical arcs have no axis end points (they are reference geometry, never solved as ellipses).

Missing arc creation tools (compared with the strip, the sketch parity and reference notes in docs/research; not built):
- Tangent arc: start at the end of a selected line or arc and run tangent to it (the Arc tool only adds the tangent constraint when it happens to start at a line end).
- Arc by two end points and a radius (or a chord and sweep).
- Arc from the centre by start point and included angle in the sketch card (typed sweep exists while drawing only).
- Tangent circle variants: circle tangent to two or three curves; arc tangent to two curves.
- Hyperbola and parabola arcs (already Parked in docs/progress.md).
- Elliptical arc by three points or by the bounding rectangle, and a typed start angle for the Ellipse arc tool.
- Spiral and conic section curves (research reference.md lists spiral).

Human-only checks: the feel of the five clicks and the start/end direction with a real mouse; the whole-ellipse preview while choosing the start; dragging an end of an elliptical arc along its ellipse; the viewport after Split on an ellipse (the cut point is not marked until it is hovered).
