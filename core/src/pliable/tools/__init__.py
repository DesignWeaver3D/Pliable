"""Tool API and the tools themselves: one file per tool, registered in the order imported below.

`base` holds the declarations (Tool, Param, Accepts, Handle, Selection, register, TOOLS); the names other modules
use are re-exported here. A new tool is a new file plus one import line in the list below."""

from .base import TOOLS, Accepts, Handle, Param, Selection, Tool, get_tool, register, round_handles  # noqa: F401
from . import push_pull, push_pull_surface, fillet_chamfer  # noqa: F401  (registered first, in this order)
from . import delete_face, remove_round, fill_hole, resize_hole, move_hole, pattern_hole, pattern_hole_circular, add_hole, add_counterbore, add_countersink  # noqa: F401
from . import align_holes, distribute_holes, add_boss, add_slot, center_between, add_box, add_cylinder, shell, mirror, patch_fill  # noqa: F401
from . import bridge, unify, draft, align_face, move_body, rotate_body, scale_body, add_sphere, add_cone, add_torus  # noqa: F401
from . import linear_array, circular_array, revolve_face, chamfer_two_distances, chamfer_distance_angle, body_boolean, variable_fillet, fillet_per_edge, loft_faces, sweep_face  # noqa: F401
from . import path_array, resize_fillet, resize_chamfer, cut_plane, split_plane, offset_body, round_face, inset_face, divide_face  # noqa: F401
from .. import features  # noqa: E402,F401  (registers the feature tools)
from .. import stretch  # noqa: E402,F401  (registers the stretch tool)
