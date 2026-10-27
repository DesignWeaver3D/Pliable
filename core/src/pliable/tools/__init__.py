"""Tool API and the tools themselves: one file per tool, named after its id.

`base` holds the declarations (Tool, Param, Accepts, Handle, Selection, register, TOOLS); the names other modules
use are re-exported here. Registration order is the order of the imports below (it is the order of the toolbar and
the tool list, and tests/test_tool_registry.py checks it), so a new tool is a new file plus one import line here."""

from .base import TOOLS, Accepts, Handle, Param, Selection, Tool, get_tool, register, round_handles  # noqa: F401

from . import push_pull  # noqa: F401
from . import push_pull_surface  # noqa: F401
from . import fillet_chamfer  # noqa: F401
from . import delete_face  # noqa: F401
from . import remove_round  # noqa: F401
from . import fill_hole  # noqa: F401
from . import resize_hole  # noqa: F401
from . import move_hole  # noqa: F401
from . import pattern_hole  # noqa: F401
from . import pattern_hole_circular  # noqa: F401
from . import add_hole  # noqa: F401
from . import add_counterbore  # noqa: F401
from . import add_countersink  # noqa: F401
from . import align_holes  # noqa: F401
from . import distribute_holes  # noqa: F401
from . import add_boss  # noqa: F401
from . import add_slot  # noqa: F401
from . import center_between  # noqa: F401
from . import add_box  # noqa: F401
from . import add_cylinder  # noqa: F401
from . import shell  # noqa: F401
from . import mirror  # noqa: F401
from . import patch_fill  # noqa: F401
from . import bridge  # noqa: F401
from . import unify  # noqa: F401
from . import draft  # noqa: F401
from . import align_face  # noqa: F401
from . import move_body  # noqa: F401
from . import rotate_body  # noqa: F401
from . import scale_body  # noqa: F401
from . import add_sphere  # noqa: F401
from . import add_cone  # noqa: F401
from . import add_torus  # noqa: F401
from . import add_prism  # noqa: F401
from . import linear_array  # noqa: F401
from . import circular_array  # noqa: F401
from . import concentric_array  # noqa: F401
from . import revolve_face  # noqa: F401
from . import chamfer_two_distances  # noqa: F401
from . import chamfer_distance_angle  # noqa: F401
from . import body_boolean  # noqa: F401
from . import variable_fillet  # noqa: F401
from . import fillet_per_edge  # noqa: F401
from . import loft_faces  # noqa: F401
from . import sweep_face  # noqa: F401
from . import path_array  # noqa: F401
from . import resize_fillet  # noqa: F401
from . import resize_chamfer  # noqa: F401
from . import cut_plane  # noqa: F401
from . import split_plane  # noqa: F401
from . import offset_body  # noqa: F401
from . import round_face  # noqa: F401
from . import inset_face  # noqa: F401
from . import divide_face  # noqa: F401
from . import edit_hole  # noqa: F401
from . import edit_void  # noqa: F401
from . import convert_to_countersink  # noqa: F401
from . import convert_to_counterbore  # noqa: F401
from . import stretch  # noqa: F401
