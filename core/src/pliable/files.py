"""STEP import and export."""

import os
import tempfile

from build123d import export_step, import_step
from build123d.topology import Shape
from OCP.TopoDS import TopoDS_Shape


def read_step(data: bytes) -> TopoDS_Shape:
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "import.step")
        with open(path, "wb") as f:
            f.write(data)
        return import_step(path).wrapped


def write_step(shape: TopoDS_Shape) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "export.step")
        export_step(Shape.cast(shape), path)
        with open(path, "rb") as f:
            return f.read()
