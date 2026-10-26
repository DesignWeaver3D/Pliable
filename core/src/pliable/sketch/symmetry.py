"""Two points mirrored about a line, built from plain constraints.

The solver library's own symmetric-about-a-line constraint ignores the line when it is used inside a workplane (it
always mirrors about the workplane's horizontal axis), so the pair is built from two constraints that do work: the
segment between the points is square to the line, and its middle lies on the line."""


def symmetric_about_line(system, point_a, point_b, line, workplane, group, middle_at) -> list[int]:
    """`middle_at` is the (u, v) middle of the points now. Handles of the constraints that make `point_a` and `point_b` mirror images about `line`."""
    between = system.addLineSegment(point_a, point_b, group)
    middle = system.addPoint2dV(workplane, middle_at[0], middle_at[1], group)  # starts where the points' middle is now
    return [
        system.addMidPoint(middle, between, workplane, group),
        system.addPointOnLine(middle, line, workplane, group),
        system.addPerpendicular(between, line, workplane, group),
    ]
