# Stand-in tests for moved modules (agent/stretch)

Status: done for this pass. Tests only; no source changes.

Covered (view): viewcamera, viewfacedir (viewcamera.test.mjs), viewfit, viewdragmeasure, viewslide, viewpick, viewselection, viewitemdrag.
Covered (sketch), all in sketchmodes.test.mjs: sketchundo, sketchleave (needsConfirm, guard), sketchkeydown, sketchconstrain (choices, chooseConstraint, changeConstraints), sketchtransform (applyEdit), sketchtypedapply.
Technique for the sketch modules: the stand-in's `active` is a getter that is true once per `arm()`, so the key handler runs and the redraw that follows (renderSketch, which needs the 3D view) returns early.

Not covered:
- view: viewlook (settings, PMREM on a renderer), viewinput (wires DOM listeners), viewboxselect (depth probe, DOM box), viewsketchpick, viewsimilarmenu (DOM menu), viewdividedrag, viewcentredrag (pointer capture plus picking; feasible later).
- sketch (DOM, the real overlay or the whole cycle): sketchpanel, sketchpanelparts, sketchbar, sketchrender, sketchpointer, sketchdimactions, sketchplanemove, sketchproject, sketchrefresh, applyConstraint (long async path with menus).

Bugs found: none.
