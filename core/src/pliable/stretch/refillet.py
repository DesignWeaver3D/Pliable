"""Re-making constant-radius fillets that a stretch turned into free-form faces: the fillet face is removed, the faces beside
it meet in a sharp edge again and the edge is filleted at the original radius, so the rubber part keeps true round corners."""

import numpy as np
from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepAlgoAPI import BRepAlgoAPI_Defeaturing
from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet
from OCP.GeomAbs import GeomAbs_Cylinder, GeomAbs_Line
from OCP.GeomAPI import GeomAPI_ProjectPointOnSurf
from OCP.GeomLProp import GeomLProp_SLProps

from ..ops import _follow, solids_of
from ..shared.solids import _volume
from ..validity import is_valid
from .body import Body

TANGENT = 1e-6  # 1 - |cosine| of the angle between two faces' normals along a shared edge that still counts as tangent
SAME_SIZE = 0.02  # how far (as a share of the volume) the re-made solid may differ from the free-form one it replaces


def _normal_at(face, point) -> np.ndarray | None:
    surface = BRep_Tool.Surface_s(face)
    projection = GeomAPI_ProjectPointOnSurf(point, surface)
    if projection.NbPoints() == 0:
        return None
    u, v = projection.LowerDistanceParameters()
    props = GeomLProp_SLProps(surface, u, v, 1, 1e-9)
    if not props.IsNormalDefined():
        return None
    n = props.Normal()
    return np.array([n.X(), n.Y(), n.Z()])


def constant_radius_fillets(body: Body) -> list:
    """The faces that are round fillets of one radius: a cylinder face with two straight edges along its axis, each shared with a
    face that meets it tangentially. A list of (face number, radius, [the two neighbors' face numbers])."""
    found = []
    for number, face in enumerate(body.faces):
        surface = BRepAdaptor_Surface(face)
        if surface.GetType() != GeomAbs_Cylinder:
            continue
        cylinder = surface.Cylinder()
        axis, radius = cylinder.Axis(), cylinder.Radius()
        direction = np.array([axis.Direction().X(), axis.Direction().Y(), axis.Direction().Z()])
        sides = []
        for edge_number in body.face_edges[number]:
            curve = BRepAdaptor_Curve(body.edges[edge_number])
            if curve.GetType() != GeomAbs_Line:
                continue
            d = curve.Line().Direction()
            if abs(abs(np.dot(direction, [d.X(), d.Y(), d.Z()])) - 1) > 1e-9:
                continue
            others = [f for f in body.edge_faces[edge_number] if f != number]
            if len(others) != 1:
                continue
            middle = curve.Value((curve.FirstParameter() + curve.LastParameter()) / 2)
            there = _normal_at(body.faces[others[0]], middle)
            here = _normal_at(face, middle)
            if there is None or here is None or 1 - abs(float(there @ here)) > TANGENT:
                continue
            sides.append(others[0])
        if len(sides) == 2 and sides[0] != sides[1]:
            found.append((number, radius, sides))
    return found


def remake_fillets(body: Body, solid, new_faces: list, kept: list):
    """The stretched `solid` with each of the body's fillets that is no longer a cylinder re-made at its radius, and the shapes of
    `kept` (a list of shape lists) followed into it; (solid, kept, how many fillets were re-made). The solid comes back
    unchanged when the faces beside a fillet cannot meet in a clean edge or the fillet cannot be made."""
    wanted = []
    for number, radius, sides in constant_radius_fillets(body):
        face = new_faces[number]
        if face is not None and BRepAdaptor_Surface(face).GetType() != GeomAbs_Cylinder:
            wanted.append((face, radius, [new_faces[s] for s in sides]))
    if not wanted or any(s is None for _, _, sides in wanted for s in sides):
        return solid, kept, 0
    try:
        removal = BRepAlgoAPI_Defeaturing()
        removal.SetShape(solid)
        for face, _, _ in wanted:
            removal.AddFaceToRemove(face)
        removal.SetRunParallel(True)
        removal.Build()
        if not removal.IsDone() or removal.Shape().IsNull() or len(solids_of(removal.Shape())) != 1:
            return solid, kept, 0
        sharp = solids_of(removal.Shape())[0]
        after = Body(sharp)
        fillet = BRepFilletAPI_MakeFillet(sharp)
        for _, radius, sides in wanted:
            a, b = ([after.face_number(f) for f in _follow(removal, [side])] for side in sides)
            common = {e for x in a if x is not None for e in after.face_edges[x]} & {e for y in b if y is not None for e in after.face_edges[y]}
            if len(common) != 1:
                return solid, kept, 0
            fillet.Add(radius, after.edges[next(iter(common))])
        fillet.Build()
        if not fillet.IsDone() or fillet.Shape().IsNull() or len(solids_of(fillet.Shape())) != 1:
            return solid, kept, 0
        made = solids_of(fillet.Shape())[0]
        if not is_valid(made) or abs(_volume(made) - _volume(solid)) > SAME_SIZE * _volume(solid):
            return solid, kept, 0
        return made, [_follow(fillet, _follow(removal, shapes)) for shapes in kept], len(wanted)
    except Exception:
        return solid, kept, 0
