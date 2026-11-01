"""Session methods for reading and writing files: STEP import and combine, project files, CAD and mesh export."""

import base64
import time

from OCP.gp import gp_Vec

from .. import bodies as body_ids
from .. import diagnostics, projectfile
from ..document import Document
from ..files import part_names, read_step_parts, read_step_tree, write_cad, write_mesh, write_step
from ..ops import solids_of
from ..shared.solids import combine
from ..tools import Selection
from .common import RequestError, _ms


class FileHandlers:
    """Session methods for reading and writing files: STEP import and combine, project files, CAD and mesh export."""

    @staticmethod
    def _read_cad(reader, request):
        """Read the file in `request["data"]` with `reader` (read_step_parts or read_step_tree); its type comes from `request["extension"]` (STEP when missing)."""
        try:
            return reader(base64.b64decode(request["data"]), str(request.get("extension") or "step"))
        except ValueError as e:
            raise RequestError(str(e)) from e

    def _import_step(self, request):
        start = time.perf_counter()
        shape, warnings, named = self._read_cad(read_step_parts, request)
        self.document = Document(shape, request.get("name", "Imported"), body_ids.fresh(shape, body_ids.namer(named)))
        self.import_warnings = warnings
        self._autosave(fresh=True)
        return self._mesh_reply(self.document.current, {"importMs": _ms(start)}, name=self.document.name, warnings=warnings, solids=len(solids_of(shape)))

    def _combine_step(self, request):
        document = self._require_document()
        start = time.perf_counter()
        root = self._read_cad(read_step_tree, request)
        other, named = root.wrapped, part_names(root)
        offset = gp_Vec(float(request.get("dx", 0)), float(request.get("dy", 0)), float(request.get("dz", 0)))
        result = combine(document.current.shape, other, str(request.get("mode", "union")), offset)
        target = document.commit(result.shape, names=body_ids.namer(named, by_size=True))
        self._autosave()
        return self._mesh_reply(target, {"opMs": _ms(start)}, selection=Selection().to_json())

    def _export_step(self, request):
        document = self._require_document()
        data = write_step(document.current.shape)
        return {"name": document.name, "data": base64.b64encode(data).decode()}

    def _export_cad(self, request):
        document = self._require_document()
        try:
            data = write_cad(document.current.shape, str(request.get("format")), [b.name for b in document.current.bodies.bodies])
        except ValueError as e:
            raise RequestError(str(e)) from e
        return {"name": document.name, "data": base64.b64encode(data).decode()}

    def _save_project(self, request):
        document = self._require_document()
        return {"name": document.name, "data": base64.b64encode(projectfile.pack(document.to_project())).decode()}

    def _open_project(self, request):
        try:
            project = projectfile.unpack(base64.b64decode(request["data"]))
        except projectfile.ProjectFileError as e:
            self.last_tool = {"tool": "open_project", "commit": True, "ok": False, "error": diagnostics.scrub(str(e))}
            raise RequestError(str(e)) from e
        self.last_tool = {"tool": "open_project", "commit": True, "ok": True, "error": None}
        self.document = Document.from_project(project)
        self._autosave(fresh=True)
        return self._mesh_reply(self.document.current, {}, name=self.document.name)

    def _export_mesh(self, request):
        document = self._require_document()
        try:
            kwargs = {}
            for key, name in (("linear", "linear"), ("angular", "angular")):
                if key in request:
                    if isinstance(request[key], bool) or not isinstance(request[key], (int, float)):
                        raise RequestError(f"{name} deflection must be a number")
                    kwargs[name] = float(request[key])
            data = write_mesh(document.current.shape, str(request.get("format")), **kwargs)
        except ValueError as e:
            raise RequestError(str(e)) from e
        return {"name": document.name, "data": base64.b64encode(data).decode()}
