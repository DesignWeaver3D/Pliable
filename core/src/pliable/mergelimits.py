"""The limits of the face merge, by kind, shared by the kernel's merge (facemerge.py) and the same-surface merge
(samesurface.py).

Two faces merge when their normals agree along the shared edge. The kernel's own limit (1e-12 radians) is below the error
of an edge's approximated curves on a surface: where a bore crosses a curved wall the edge is free-form, and the two halves
of the bore never merged although they are one surface. This limit is still a ten-thousandth of the smallest draft angle
anyone models (0.01 degrees is 1.7e-4 radians).
"""

import math

MERGE_ANGLE = 1e-6  # radians: directions and semi-angles that count as equal
MERGE_LENGTH = 1e-6  # mm: radii, offsets and distances of an axis that count as equal
CONNECT_LENGTH = 1e-5  # mm: edges this close at their ends form one outline
MERGE_RELATIVE = 1e-6  # fraction: a merged solid keeps its volume and area within this (the kernel's integrals of a fused shape are only about 1e-7 exact)
PARALLEL = 1.0 - math.cos(MERGE_ANGLE)  # 1 - |cosine| of the angle between two directions that count as parallel (5e-13)
