"""Which circles (and ellipses without axis ends) still have a free size: a circle whose centre is placed is not fully constrained until its size is too."""

from .solver import SOLVE_GROUP, _Solver


def free_circle_sizes(sketch: dict) -> list[int]:
    """Ids of the circles whose radius the constraints do not fix. Adding the radius it has now as a dimension is
    reported as a redundancy by the solver exactly when the radius was already fixed."""
    circles = [e for e in sketch.get("entities", []) if e["type"] == "circle"]
    # An ellipse without minor axis ends has its short radius outside the solver; only a minor radius dimension fixes it (a projected one is a reference).
    dimensioned = {c.get("entity") for c in sketch.get("constraints", []) if c["type"] == "minor_radius" and not c.get("reference")}
    free = [e["id"] for e in sketch.get("entities", []) if e["type"] == "ellipse" and "minor1" not in e and not e.get("reference") and e["id"] not in dimensioned]
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
