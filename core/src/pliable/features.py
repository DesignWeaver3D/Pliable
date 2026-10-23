"""Feature tools beyond push/pull and fillet: delete face (heal), hole edits, primitives, shell, mirror, draft.

Every tool is registered with `@register` and shows up in the UI's tool list without frontend changes.
Holes are edited by fusing the old cylinder back in (which fills the hole exactly) and cutting a new one,
so no history or topological naming is needed: the tool reads what the face is now.
"""

import math

from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepAlgoAPI import BRepAlgoAPI_Defeaturing
from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy, BRepBuilderAPI_MakeSolid, BRepBuilderAPI_Sewing, BRepBuilderAPI_Transform
from OCP.BRepFill import BRepFill_Filling
from OCP.TopAbs import TopAbs_FACE, TopAbs_SHELL
from OCP.TopExp import TopExp_Explorer as _Explorer
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.BRepOffsetAPI import BRepOffsetAPI_DraftAngle, BRepOffsetAPI_MakeThickSolid
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCone, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeRevol, BRepPrimAPI_MakeSphere, BRepPrimAPI_MakeTorus
from OCP.BRepBndLib import BRepBndLib
from OCP.Bnd import Bnd_Box
from OCP.BRepTools import BRepTools
from OCP.GProp import GProp_GProps
from OCP.TopAbs import TopAbs_REVERSED
from OCP.GeomAbs import GeomAbs_C0, GeomAbs_G1, GeomAbs_Cylinder, GeomAbs_Line, GeomAbs_Plane, GeomAbs_Torus
from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain
from OCP.BRep import BRep_Builder
from OCP.TopoDS import TopoDS, TopoDS_Compound, TopoDS_Shape
from OCP.collections import List_TopoDS_Shape
from OCP.gp import gp_Ax1, gp_Ax2, gp_Dir, gp_Pln, gp_Pnt, gp_Trsf, gp_Vec

from .ops import edge_curve, edge_outward_normal, face_handle_point, MIN_DISTANCE, OperationError, OpResult, _boolean, _contains, planar_normal, push_pull, solids_of
from .tools import Accepts, Handle, Param, Tool, get_tool, register, round_handles
from .shared.arrays import _array_copies, _fuse_copies
from .shared.bodies import _body_bounds, _body_centre, _chosen_solids, _on_bodies, _pivot_point
from .shared.faces import _chamfer_with_face, _face_edges, _PlanarFace, _plane_axes, _rebuild_round
from .shared.hole_groups import _CylinderFaces, _HoleGroup, _HoleOnFace, _holes, apply_holes, Hole
from .shared.planes import _cut_target, _model_middle, _plane_frame, _plane_handles, _plane_normal, _tilted, TILT
from .shared.primitives import _position_handles, _turned, _with_rotation, ROTATION
from .shared.solids import (
    _add_material,
    _bounds_diagonal,
    _combine,
    _compound,
    _cylinder,
    _defeature,
    _faces_of,
    _new_body,
    _sew_into,
    _volume,
    finish,
    NEW_BODY,
    TOL,
)

# Solids ----------------------------------------------------------------------------------------------


# Whole-body transforms and more primitives -----------------------------------------------------------------


# Re-radius a fillet ---------------------------------------------------------------------------------------


from . import hole_tools  # noqa: E402,F401  (registers the hole tools; it needs `finish` defined above)
