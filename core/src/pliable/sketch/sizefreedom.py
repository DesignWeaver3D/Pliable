"""Which circles (and ellipses without axis ends) still have a free size: a circle whose center is placed is not fully constrained until its size is too."""

from .solver import SOLVE_GROUP, _Solver, free_ellipse_minors


def free_circle_sizes(sketch: dict) -> list[int]:
    """Ids of the circles whose radius the constraints do not fix. Adding the radius it has now as a dimension is
    reported as a redundancy by the solver exactly when the radius was already fixed."""
    circles = [e for e in sketch.get("entities", []) if e["type"] == "circle"]
    free = free_ellipse_minors(sketch)  # an ellipse without minor axis ends has its short radius outside the solver
    if not circles:
        return free
    for circle in circles:
        solver = _Solver(sketch)
        for c in sketch.get("constraints", []):
            if not c.get("reference"):
                solver.add_constraint(c)
        if solver.solve()["status"] != "ok":
            return []
        solver.system.addDiameter(2 * circle["radius"], solver._entity(circle["id"], "circle"), SOLVE_GROUP)
        if solver.solve()["status"] == "ok":
            free.append(circle["id"])
    return free
