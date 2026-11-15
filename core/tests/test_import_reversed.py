"""An imported closed solid that is still reversed after the repair is turned round, and the import note names what it cannot fix."""

from build123d import Box
from OCP.TopoDS import TopoDS

from pliable import files
from pliable.files import check_import
from pliable.ops import solids_of
from pliable.volume import volume_of


def reversed_box():
    return TopoDS.Solid(Box(10, 10, 10).solids()[0].wrapped.Reversed())


def test_reversed_solid_is_repaired():
    solid = reversed_box()
    assert volume_of(solid) < 0
    shape, warnings = check_import(solid)
    assert [volume_of(s) for s in solids_of(shape)] == [1000.0] or abs(volume_of(shape) - 1000) < 1e-6
    assert any("inside-out" in w and "repaired" in w for w in warnings)


def test_reversed_solid_is_turned_round_when_the_repair_leaves_it(monkeypatch):
    class Idle:
        def __init__(self, solid):
            self._solid = solid

        def Perform(self):
            pass

        def Solid(self):
            return self._solid

    monkeypatch.setattr(files, "ShapeFix_Solid", Idle)
    shape, warnings = check_import(reversed_box())
    assert abs(volume_of(shape) - 1000) < 1e-6
    assert any("repaired" in w for w in warnings)


def test_unfixable_solid_is_named(monkeypatch):
    class Idle:
        def __init__(self, solid):
            self._solid = solid

        def Perform(self):
            pass

        def Solid(self):
            return self._solid

    monkeypatch.setattr(files, "ShapeFix_Solid", Idle)
    real = files._volume
    monkeypatch.setattr(files, "_volume", lambda s: -1.0 if real(s) else 0.0)
    shape, warnings = check_import(reversed_box())
    assert any("could not be fixed" in w for w in warnings)
