"""Session methods for datum planes and mirror planes: creating and editing them."""

from .. import sketch, unwrap
from .common import RequestError


class DatumHandlers:
    """Session methods for datum planes and mirror planes: creating and editing them."""

    def _datum_plane(self, request: dict) -> dict:
        """The plane of a new datum: any plane a sketch can sit on (a standard plane, a face, vertices, an edge, each
        with an offset), or the mid-plane of two parallel flat faces (`midplane`: [face, face])."""
        if "midplane" not in request:
            return self._sketch_plane(request)
        topology = self._require_document().current
        try:
            a, b = [int(i) for i in request["midplane"]]
            faces = [topology.face(a), topology.face(b)]
        except (KeyError, ValueError, TypeError) as e:
            raise RequestError("Pick two parallel flat faces") from e
        if not all(unwrap.is_flat(f) for f in faces):
            raise RequestError("Both faces must be flat")
        first, second = [sketch.face_plane(f) for f in faces]
        n = first["normal"]
        if abs(sum(x * y for x, y in zip(n, second["normal"]))) < 1 - 1e-6:
            raise RequestError("The two faces are not parallel")
        gap = sum((q - p) * k for p, q, k in zip(first["origin"], second["origin"], n))
        return sketch.offset_plane(first, gap / 2)

    def _mirror_edit(self, request: dict, kind: str) -> bytes:
        """Turn mirror mode on for a plane (a datum plane by `datum_id`, else any plane a datum could be made on) or off."""
        document = self._require_document()
        if kind == "mirror_clear":
            mirror = None
        elif request.get("datum_id") is not None:
            try:
                entry = next(e for e in document.datum_list() if e["id"] == int(request["datum_id"]))
            except (StopIteration, ValueError, TypeError) as e:
                raise RequestError("No such datum plane") from e
            mirror = {"name": entry["name"], "plane": entry["plane"]}
        else:
            name = str(request.get("name") or "").strip() or (f"{request['plane']} origin plane" if "plane" in request else "Mirror plane")
            mirror = {"name": name, "plane": self._datum_plane(request)}
        target = document.set_mirror(mirror)
        self._autosave()
        return self._mesh_reply(target, {}, preview=False)

    def _datum_edit(self, request: dict, kind: str) -> bytes:
        document = self._require_document()
        entries = document.datum_list()
        if kind == "datum_add":
            plane = self._datum_plane(request)
            number = document.new_datum_id()
            name = str(request.get("name") or "").strip() or f"Plane {number}"
            entries.append({"id": number, "name": name, "plane": plane})
        else:
            try:
                entry = next((e for e in entries if e["id"] == int(request["datum_id"])), None)
            except (KeyError, ValueError, TypeError) as e:
                raise RequestError("Unknown datum plane") from e
            if entry is None:
                raise RequestError("No such datum plane")
            if kind == "datum_delete":
                entries.remove(entry)
            elif kind == "datum_move":
                try:
                    entry["plane"] = sketch.offset_plane(entry["plane"], float(request["distance"]))
                except (KeyError, ValueError, TypeError) as e:
                    raise RequestError("Malformed datum request") from e
            else:
                name = str(request.get("name", "")).strip()
                if not name:
                    raise RequestError("A datum plane needs a name")
                entry["name"] = name
        target = document.set_datums(entries)
        self._autosave()
        return self._mesh_reply(target, {}, preview=False)
