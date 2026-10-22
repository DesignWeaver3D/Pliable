"""The Pliable project file (`.plbl`): one model state in a zip container.

Layout (format 1):
  project.json  {"kind": "pliable-project", "format": 1, "name": ..., "model": "model.brep",
                 "objects": {"bodies": [...], "sketches": [...], "sketch_next": n, ...future types...}}
  model.brep    the whole model as one native BREP compound

`objects` is an open map from an object type to its data. Types this release does not know are
kept as they are (`Project.other`) and written back, so a file made by a newer release loses
nothing when saved again. Files with a newer `format` are refused. Autosave writes one such
file per undo state (see autosave.py), so a saved project and a crash backup are the same thing.
"""

import io
import json
import os
import tempfile
import zipfile
from dataclasses import dataclass, field

from OCP.BRep import BRep_Builder
from OCP.BRepTools import BRepTools
from OCP.TopoDS import TopoDS_Shape

from . import bodies as body_ids
from .bodies import BodyState

FORMAT = 1
KIND = "pliable-project"
EXTENSION = ".plbl"
KNOWN_OBJECTS = ("bodies", "sketches", "sketch_next", "datums", "datum_next", "mirror")  # the rest of `objects` is carried through untouched


class ProjectFileError(ValueError):
    """The file is not a project this release can open."""


@dataclass
class Project:
    shape: TopoDS_Shape
    bodies: BodyState
    name: str = "Untitled"
    sketches: list[dict] = field(default_factory=list)
    sketch_next: int = 1
    datums: list[dict] = field(default_factory=list)  # datum planes: {id, name, plane}
    datum_next: int = 1
    mirror: dict | None = None  # mirror modeling mode: {name, plane} while on
    other: dict = field(default_factory=dict)  # object types this release does not know, kept for saving again


def _brep_bytes(shape: TopoDS_Shape) -> bytes:
    handle, path = tempfile.mkstemp(suffix=".brep")
    os.close(handle)
    try:
        if not BRepTools.Write_s(shape, path):
            raise OSError("could not write the model")
        with open(path, "rb") as f:
            return f.read()
    finally:
        os.unlink(path)


def _brep_shape(data: bytes) -> TopoDS_Shape:
    handle, path = tempfile.mkstemp(suffix=".brep")
    os.close(handle)
    try:
        with open(path, "wb") as f:
            f.write(data)
        shape = TopoDS_Shape()
        if not BRepTools.Read_s(shape, path, BRep_Builder()):
            raise ProjectFileError("The model inside the project file is damaged")
        return shape
    finally:
        os.unlink(path)


def pack(project: Project) -> bytes:
    objects = dict(project.other)
    objects["bodies"] = project.bodies.to_json()
    objects["sketches"] = project.sketches
    objects["sketch_next"] = project.sketch_next
    objects["datums"] = project.datums
    objects["datum_next"] = project.datum_next
    objects["mirror"] = project.mirror
    manifest = {"kind": KIND, "format": FORMAT, "name": project.name, "model": "model.brep", "objects": objects}
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("project.json", json.dumps(manifest))
        z.writestr("model.brep", _brep_bytes(project.shape))
    return out.getvalue()


def unpack(data: bytes) -> Project:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            manifest = json.loads(z.read("project.json"))
            model = z.read(str(manifest.get("model", "model.brep")))
    except (zipfile.BadZipFile, KeyError, ValueError) as e:
        raise ProjectFileError("This is not a Pliable project file") from e
    if not isinstance(manifest, dict) or manifest.get("kind") != KIND:
        raise ProjectFileError("This is not a Pliable project file")
    if int(manifest.get("format", 0)) > FORMAT:
        raise ProjectFileError("This project was saved by a newer version of Pliable")
    objects = manifest.get("objects") or {}
    try:
        bodies = BodyState.from_json(objects["bodies"]) if "bodies" in objects else None
        shape = _brep_shape(model)
    except (KeyError, TypeError, ValueError) as e:
        raise ProjectFileError("The project file is damaged") from e
    return Project(
        shape,
        bodies if bodies is not None else body_ids.fresh(shape),
        str(manifest.get("name", "Untitled")),
        list(objects.get("sketches") or []),
        int(objects.get("sketch_next") or 1),
        list(objects.get("datums") or []),
        int(objects.get("datum_next") or 1),
        objects.get("mirror") or None,
        {k: v for k, v in objects.items() if k not in KNOWN_OBJECTS},
    )
