"""Drawn edges lie on the face triangles: where curved faces meet (a fillet) the edge must not sit inside the surface."""

import numpy as np
from build123d import Axis, Box, fillet
from OCP.BRep import BRep_Tool
from OCP.TopAbs import TopAbs_EDGE
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS

from pliable.tessellate import tessellate
from pliable.topology import Topology


def _filleted_block():
    block = Box(40, 30, 20)
    block = fillet(block.edges().filter_by(Axis.Z), 6)  # round the vertical edges
    return fillet(block.faces().sort_by(Axis.Z)[-1].edges(), 3)  # then the top rim, where curved faces meet curved faces


def _boundary_nodes(topology):
    """Every node of every face triangulation that lies on a face boundary (as positions)."""
    nodes = []
    for _, face in topology.faces():
        location = TopLoc_Location()
        triangulation = BRep_Tool.Triangulation_s(face, location)
        explorer = TopExp_Explorer(face, TopAbs_EDGE)
        while explorer.More():
            polygon = BRep_Tool.PolygonOnTriangulation_s(TopoDS.Edge(explorer.Current()), triangulation, TopLoc_Location())
            if polygon is not None:
                for k in range(1, polygon.NbNodes() + 1):
                    p = triangulation.Node(polygon.Node(k))
                    nodes.append((p.X(), p.Y(), p.Z()))
            explorer.Next()
    return np.array(nodes)


def test_every_drawn_edge_vertex_is_a_face_boundary_node():
    topology = Topology(_filleted_block().wrapped)
    mesh = tessellate(topology)
    nodes = _boundary_nodes(topology)
    drawn = mesh.edge_positions.reshape(-1, 3)
    away = [float(np.min(np.linalg.norm(nodes - p, axis=1))) for p in drawn]
    assert max(away) < 1e-4  # float32 positions; before, rounded edges were up to a few hundredths of a unit off


def test_edges_still_cover_every_edge_once():
    topology = Topology(_filleted_block().wrapped)
    mesh = tessellate(topology)
    assert len(mesh.edges) == sum(1 for _ in topology.edges())
    assert all(e["count"] >= 2 for e in mesh.edges)
