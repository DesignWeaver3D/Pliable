# ellarc agent notes

Status: (1) Ellipse arc tool built and committed. See below for (2) to (4).

Design: an elliptical arc is an `ellipse` entity with `start` and `end` point ids (counterclockwise). Core: `profiles._ellipse_edge`
cuts the edge by parameter; `solver._add_entity` holds both ends on the ellipse (foci construction, skipped for axis ends);
`solver._in_steps` solves size changes in 8 steps (one jump stretched the ellipse). App: `sketchellipse.ts` (geometry),
`addEllipseArc` in `sketchbuilders.ts`, tool `ellarc` in `sketch.ts`, preview, typed sizes, icon.

Human-only checks: real-mouse feel of the five clicks and the start/end direction; the preview of the whole ellipse while choosing the start.
