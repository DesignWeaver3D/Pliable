"""Runs the kernel's mesher on a body, only when a face of it has no usable triangulation.

A flat face with many holes (a perforated plate's top and bottom) is where the default triangulation algorithm is slow:
about 0.4 s for a face with 400 holes. The kernel's other algorithm does such a face about five times faster with the
same triangles, but leaves some faces unmeshed (seen on the outlines of text), so it is used for those busy flat faces
only, and the default algorithm then meshes everything still missing.
"""

from OCP.BRep import BRep_Builder, BRep_Tool
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.IMeshTools import IMeshTools_MeshAlgoType_Delabella, IMeshTools_Parameters
from OCP.TopAbs import TopAbs_FACE
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS, TopoDS_Compound, TopoDS_Iterator, TopoDS_Shape

from .opsgeom import planar_normal

MANY_HOLES = 8  # inner loops from which a flat face goes to the faster algorithm


def _stale(face, deflection: float) -> bool:
    """True when the face has no triangulation at this deflection (a changed or new face)."""
    triangulation = BRep_Tool.Triangulation_s(face, TopLoc_Location())
    return triangulation is None or triangulation.Deflection() > deflection * 1.0000001


def _stale_faces(solid: TopoDS_Shape, deflection: float, first_only: bool = False) -> list:
    found = []
    explorer = TopExp_Explorer(solid, TopAbs_FACE)
    while explorer.More():
        face = TopoDS.Face(explorer.Current())
        if _stale(face, deflection):
            found.append(face)
            if first_only:
                break
        explorer.Next()
    return found


def needs_mesh(solid: TopoDS_Shape, deflection: float) -> bool:
    """True when a face of the solid has no triangulation at this deflection."""
    return bool(_stale_faces(solid, deflection, first_only=True))


def _holes(face) -> int:
    loops = 0
    children = TopoDS_Iterator(face)
    while children.More():
        loops += 1
        children.Next()
    return loops - 1


def mesh(solid: TopoDS_Shape, deflection: float, angle: float) -> None:
    """Mesh the faces of `solid` that need it. Faces that already have a triangulation at this deflection keep it."""
    stale = _stale_faces(solid, deflection)
    if not stale:
        return
    busy = [face for face in stale if _holes(face) >= MANY_HOLES and planar_normal(face) is not None]
    if busy:
        group, builder = TopoDS_Compound(), BRep_Builder()
        builder.MakeCompound(group)
        for face in busy:
            builder.Add(group, face)
        parameters = IMeshTools_Parameters()
        parameters.Deflection = deflection
        parameters.Angle = angle
        parameters.InParallel = True
        parameters.MeshAlgo = IMeshTools_MeshAlgoType_Delabella
        try:
            BRepMesh_IncrementalMesh(group, parameters)
        except Exception:  # whatever it leaves unmeshed, the default algorithm does next
            pass
    BRepMesh_IncrementalMesh(solid, deflection, False, angle, True)
