"""Tools keep a compound body (one body of several solids) when the model has other bodies too."""

import pytest
from build123d import Box, Pos
from OCP.BRep import BRep_Builder
from OCP.TopAbs import TopAbs_COMPSOLID
from OCP.TopoDS import TopoDS_Compound

from pliable.document import Document
from pliable.measurebody import measure_body
from pliable.ops import _faces_of, solids_of
from pliable.tools import Selection, get_tool


def _document():
    """Body 1 is a compound of two boxes apart, body 2 a plain box far away."""
    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    for x in (0, 30, 100):
        builder.Add(compound, (Pos(x, 0, 0) * Box(10, 10, 10)).wrapped)
    document = Document(compound)
    document.commit(get_tool("body_boolean").execute(document.current, Selection(bodies=[1, 2]), {"mode": 0}, preview=False).shape)
    return document


def _kinds(document):
    return [s.ShapeType() == TopAbs_COMPSOLID for s in solids_of(document.current.shape)]


def _run(document, tool, selection, params):
    result = get_tool(tool).execute(document.current, selection, params, preview=False)
    document.commit(result.shape)


def _body_ids(document):
    return [b.id for b in document.current.bodies.bodies]


def test_start_is_a_compound_and_a_plain_body():
    assert sorted(_kinds(_document())) == [False, True]


@pytest.mark.parametrize("tool,params", [("move_body", {"dx": 7, "dy": 3}), ("move_body", {"rz": 30, "dx": 5}), ("move_body", {"rz": 45})])
def test_move_and_rotate_keep_the_compound(tool, params):
    document = _document()
    compound_id = next(b.id for b, k in zip(document.current.bodies.bodies, _kinds(document)) if k)
    _run(document, tool, Selection(bodies=[compound_id]), params)
    assert sorted(_kinds(document)) == [False, True]
    assert len(document.current.bodies.bodies) == 2
    document.undo()
    assert sorted(_kinds(document)) == [False, True]


def test_move_the_plain_body_keeps_the_compound():
    document = _document()
    plain_id = next(b.id for b, k in zip(document.current.bodies.bodies, _kinds(document)) if not k)
    _run(document, "move_body", Selection(bodies=[plain_id]), {"dx": 5})
    assert sorted(_kinds(document)) == [False, True]


def test_fillet_an_edge_of_the_compound_keeps_it():
    document = _document()
    index = next(i for i, k in enumerate(_kinds(document)) if k)
    solid = solids_of(document.current.shape)[index]
    edge = next(i for i, e in document.current.edges() if any(e.IsSame(x) for x in _edges_of(solid)))
    _run(document, "fillet_chamfer", Selection(edges=[edge]), {"distance": 1})
    assert sorted(_kinds(document)) == [False, True]


def _edges_of(solid):
    from OCP.TopAbs import TopAbs_EDGE
    from OCP.TopExp import TopExp_Explorer

    explorer, found = TopExp_Explorer(solid, TopAbs_EDGE), []
    while explorer.More():
        found.append(explorer.Current())
        explorer.Next()
    return found


def test_mirror_and_array_of_the_compound_body():
    document = _document()
    compound_id = next(b.id for b, k in zip(document.current.bodies.bodies, _kinds(document)) if k)
    _run(document, "mirror", Selection(bodies=[compound_id]), {"offset": -50, "plane": 3})
    assert sum(_kinds(document)) >= 1 and len(solids_of(document.current.shape)) >= 2


def test_hole_in_a_compound_member_keeps_the_compound():
    document = _document()
    index = next(i for i, k in enumerate(_kinds(document)) if k)
    solid = solids_of(document.current.shape)[index]
    top = next(i for i, f in document.current.faces() if i is not None and _is_top(f) and any(f.IsSame(x) for x in _faces_of(solid)))
    _run(document, "add_hole", Selection(faces=[top]), {"diameter": 3, "depth": 4})
    assert sorted(_kinds(document)) == [False, True]


def _in(solid, face):
    from pliable.ops import _contains

    return _contains(solid, face)


def _is_top(face):
    from OCP.BRep import BRep_Tool
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps

    props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(face, props)
    return props.CentreOfMass().Z() > 4.9


def test_subtract_from_a_compound_body_keeps_it():
    document = _document()
    ids = _body_ids(document)
    compound_id = next(b.id for b, k in zip(document.current.bodies.bodies, _kinds(document)) if k)
    plain_id = next(i for i in ids if i != compound_id)
    # cut a small box out of the plain body using the compound as the tool? target first: subtract plain from compound
    _run(document, "body_boolean", Selection(bodies=[compound_id, plain_id]), {"mode": 1})
    kinds = _kinds(document)
    assert kinds.count(True) == 1 and len(kinds) == 1


def test_combine_cut_keeps_a_compound_body():
    from pliable.shared.solids import combine

    document = _document()
    near = (Pos(0, 0, 0) * Box(2, 2, 20)).wrapped
    bodies = solids_of(combine(document.current.shape, near, "cut").shape)
    assert sorted(b.ShapeType() == TopAbs_COMPSOLID for b in bodies) == [False, True]


def test_measure_of_a_compound_body_lists_its_solids():
    document = _document()
    compound_id = next(b.id for b, k in zip(document.current.bodies.bodies, _kinds(document)) if k)
    rows = {r["label"]: r["value"] for r in measure_body(document.current, compound_id)["rows"]}
    assert rows["Solids"] == 3 or rows["Solids"] == 2
    assert rows["Volume"] == pytest.approx(rows["Solids"] * 1000)
    assert rows["Solid 1 volume"] == pytest.approx(1000)
    plain_id = next(b.id for b in document.current.bodies.bodies if b.id != compound_id)
    assert "Solids" not in {r["label"] for r in measure_body(document.current, plain_id)["rows"]}
