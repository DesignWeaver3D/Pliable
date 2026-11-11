"""Session methods for renaming, recoloring, deleting and duplicating bodies."""

from .common import RequestError


class BodyHandlers:
    """Session methods for renaming, recoloring, deleting and duplicating bodies."""

    def _rename_body(self, request):
        document = self._require_document()
        name = str(request.get("name", "")).strip()[:80]
        if not name:
            raise RequestError("A body needs a name")
        try:
            target = document.rename_body(int(request["body"]), name)
        except (KeyError, ValueError, TypeError) as e:
            raise RequestError("Unknown body") from e
        self._autosave()
        return self._mesh_reply(target, {})

    def _set_body_material(self, request):
        document = self._require_document()
        material = request.get("material")
        if material is not None and not (isinstance(material, str) and 0 < len(material) <= 40):
            raise RequestError("Unknown material")
        try:
            target = document.set_body_material(int(request["body"]), material)
        except (KeyError, ValueError, TypeError) as e:
            raise RequestError("Unknown body") from e
        self._autosave()
        return self._mesh_reply(target, {})

    def _set_body_locked(self, request):
        document = self._require_document()
        try:
            target = document.set_body_locked(int(request["body"]), bool(request.get("locked")))
        except (KeyError, ValueError, TypeError) as e:
            raise RequestError("Unknown body") from e
        self._autosave()
        return self._mesh_reply(target, {})

    def _delete_or_duplicate_body(self, request, kind):
        document = self._require_document()
        extra: dict = {}
        try:
            if kind == "delete_body" and "bodies" in request:  # several bodies, one undo step
                target = document.delete_bodies([int(b) for b in request["bodies"]])
            elif kind == "delete_body":
                target = document.delete_body(int(request["body"]))
            else:
                target, extra["created"] = document.duplicate_body(int(request["body"]))
        except (KeyError, ValueError, TypeError) as e:
            raise RequestError("Unknown body") from e
        self._autosave()
        return self._mesh_reply(target, {}, **extra)
