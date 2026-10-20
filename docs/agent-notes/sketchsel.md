# sketchsel agent notes

Done: click-to-add selection, whole-curve drag, sketch box selection, confirm before discarding a sketch with
geometry, and the frozen-sketch fix. The freeze after "Project model edges": the many projected fixed points
pushed the solver past its limit on unknowns (result code 5), so every solve failed silently and nothing could be
dragged or constrained. Fixed by sending the solver only geometry the constraints use (`forSolver`).
Not checked in the app: Finish and keep from the confirm, starting a second sketch while one is open, multi-item drag.
