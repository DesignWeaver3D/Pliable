# Stretch agent notes

Status per task (resume from the first open one).

1. Sphere and torus recognition after the deformation: done. `stretch/ball.py` places a sphere or torus found in a rubber face so its (u, v) follow the old surface (poles or tube top/bottom and the u = v = 0 point go where the field takes them); `deform._round_surface` dispatches to it. A face with an edge shrunk to a point (a sphere cap's pole) still keeps the fitted surface, as for a cone tip. In real stretches the sphere and torus faces next to the band move rigidly with the end, so the new path is reached only by a rubber face the field moves rigidly (tests: `tests/test_stretch_ball.py`, a direct Deformer check plus Tool.execute checks that a dome and fillet tori stay one).
