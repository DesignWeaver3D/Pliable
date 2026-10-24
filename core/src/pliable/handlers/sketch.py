"""Session methods for sketches: planes, regions, projection, keeping geometry, edits and extrude."""

import copy
import time

from .. import diagnostics, sketch, unwrap
from ..mirrormode import mirror_result
from ..tools import Selection
from .common import _ms, RequestError


class SketchHandlers:
    """Session methods for sketches: planes, regions, projection, keeping geometry, edits and extrude."""

    def _sketch_on_faces(self, request: dict) -> dict:
        """One entry point for "Sketch On Face": a single flat face gives its plane, anything else (a cylinder or
        cone, a chain of faces) is unrolled flat. A refusal is remembered for the diagnostic report."""
        topology = self._require_document().current
        ids = [int(i) for i in request["faces"]]
        try:
            faces = [topology.face(i) for i in ids]
        except KeyError as e:
            raise RequestError("Unknown face") from e
        if not faces:
            raise RequestError("Select a face to sketch on")
        if len(faces) == 1 and unwrap.is_flat(faces[0]):
            plane = sketch.face_plane(faces[0])
            return {"plane": plane, "reference": sketch.face_reference(faces[0], plane), "unwrapped": False}
        try:
            unrolling = unwrap.build_unrolling(topology, ids)
        except (unwrap.UnwrapError, sketch.SketchError) as e:
            message = f"{e} ({unwrap.describe_faces(faces)})"
            self.last_tool = {"tool": "sketch_on_face", "commit": False, "ok": False, "error": diagnostics.scrub(message)}
            raise RequestError(message) from e
        self.last_tool = {"tool": "sketch_on_face", "commit": False, "ok": True, "error": None}
        reply = {"plane": unwrap.unwrap_plane(topology.shape, unrolling.reference), "reference": unrolling.reference, "unwrapped": True}
        if unrolling.distortion:
            reply["distortion"] = unrolling.distortion
        return reply

    def _sketch_plane(self, request: dict) -> dict:
        if "plane" in request:
            try:
                return sketch.offset_plane(sketch.STANDARD_PLANES[request["plane"]], float(request.get("offset", 0)))
            except KeyError:
                raise RequestError(f"Unknown plane {request['plane']!r}") from None
            except (TypeError, ValueError) as e:
                raise RequestError(f"Malformed plane request: {e!r}") from e
        topology = self._require_document().current
        if "vertices" in request or "edge" in request or "normal_to" in request:
            return self._sketch_plane_through(topology, request)
        try:
            if "tangent_face" in request:  # touching a curved or flat face at a picked vertex
                from OCP.BRep import BRep_Tool

                p = BRep_Tool.Pnt_s(topology.vertex(int(request["vertex"])))
                return sketch.tangent_plane(topology.face(int(request["tangent_face"])), (p.X(), p.Y(), p.Z()))
            plane = sketch.face_plane(topology.face(int(request["face"])))
            offset, angle = float(request.get("offset", 0)), float(request.get("angle", 0))
            return sketch.shifted_plane(plane, offset, angle) if offset or angle else plane  # moved along the face normal, then turned about the plane's x axis
        except KeyError as e:
            raise RequestError("Unknown face") from e
        except (TypeError, ValueError, sketch.SketchError) as e:
            raise RequestError(str(e)) from e

    def _sketch_plane_through(self, topology, request: dict) -> dict:
        """A plane through three vertices, or through a straight edge and a vertex."""
        from OCP.BRep import BRep_Tool
        from OCP.TopExp import TopExp
        from OCP.TopoDS import TopoDS_Vertex

        def point(vertex):
            p = BRep_Tool.Pnt_s(vertex)
            return (p.X(), p.Y(), p.Z())

        try:
            if "normal_to" in request:  # square to an edge, at a fraction along it (0.5 = the middle)
                from OCP.BRepAdaptor import BRepAdaptor_Curve
                from OCP.gp import gp_Pnt, gp_Vec

                curve = BRepAdaptor_Curve(topology.edge(int(request["normal_to"])))
                first, last = curve.FirstParameter(), curve.LastParameter()
                at = min(1.0, max(0.0, float(request.get("at", 0.5))))
                p, tangent = gp_Pnt(), gp_Vec()
                curve.D1(first + at * (last - first), p, tangent)
                if tangent.Magnitude() < 1e-12:
                    raise RequestError("That edge has no direction at that point")
                return sketch.plane_normal_to((p.X(), p.Y(), p.Z()), (tangent.X(), tangent.Y(), tangent.Z()))
            if "edge" in request:
                v1, v2 = TopoDS_Vertex(), TopoDS_Vertex()
                TopExp.Vertices_s(topology.edge(int(request["edge"])), v1, v2)
                points = [point(v1), point(v2), point(topology.vertex(int(request["vertex"])))]
            else:
                points = [point(topology.vertex(int(i))) for i in request["vertices"]]
                if len(points) != 3:
                    raise RequestError("A plane needs three vertices")
            return sketch.plane_through(*points)
        except sketch.SketchError as e:
            raise RequestError(str(e)) from e
        except (KeyError, TypeError, ValueError) as e:
            raise RequestError(f"Unknown vertex or edge: {e!r}") from e

    def _sketch_project(self, request: dict) -> dict:
        topology = self._require_document().current
        faces, edges = request.get("faces"), request.get("edges")
        shape = topology.shape
        if faces or edges:  # only what was picked: the picked edges and the edges of the picked faces
            from OCP.BRep import BRep_Builder
            from OCP.TopoDS import TopoDS_Compound

            try:
                chosen = [topology.face(int(i)) for i in faces or []] + [topology.edge(int(i)) for i in edges or []]
            except (KeyError, ValueError, TypeError, IndexError) as e:
                raise RequestError("Unknown face or edge") from e
            shape = TopoDS_Compound()
            builder = BRep_Builder()
            builder.MakeCompound(shape)
            for item in chosen:
                builder.Add(shape, item)
        return sketch.face_reference(shape, request["plane"], project=True)

    def _region_shape(self, request: dict):
        """The model shape with the sketch's closed regions added as faces (imprinted or loose)."""
        document = self._require_document()
        try:
            if "unwrap" in request:
                shape, count = unwrap.wrap_regions(document.current.shape, document.current, [int(i) for i in (request["unwrap"] if isinstance(request["unwrap"], list) else [request["unwrap"]])], request["sketch"])
            else:
                shape, count = sketch.add_regions(document.current.shape, request["sketch"], request.get("picked_regions", request.get("region")))
        except (unwrap.UnwrapError, sketch.SketchError) as e:
            raise RequestError(str(e)) from e
        except (KeyError, TypeError, ValueError) as e:
            raise RequestError(f"Malformed sketch request: {e!r}") from e
        return shape, count

    def _sketch_regions(self, request: dict) -> bytes:
        """Leave a sketch: its closed regions become faces of the model (imprinted or loose) and stay selected."""
        document = self._require_document()
        start = time.perf_counter()
        if "sketch" not in request and request.get("sketch_id") is not None:  # a kept sketch, by id
            request = {**request, "sketch": self._sketch_content(request)}
        shape, _ = self._region_shape(request)
        timings = {"opMs": _ms(start)}
        target = document.commit(shape)
        self._autosave()
        selection = Selection()
        picked = request.get("picked_regions", [request["region"]] if request.get("region") is not None else [])
        if picked:  # regions picked in the view: leave their new faces selected
            faces = []
            for region in picked:
                try:
                    face = sketch.region_face(target.shape, request["sketch"], int(region))
                except (KeyError, TypeError, ValueError, sketch.SketchError):
                    face = None
                index = target.face_id(face) if face is not None else None
                if index is not None:
                    faces.append(index)
            if faces:
                selection = Selection(faces=faces)
        return self._mesh_reply(target, timings, preview=False, selection=selection.to_json())

    @staticmethod
    def _sketch_id(request: dict) -> int:
        try:
            return int(request["sketch_id"])
        except (KeyError, TypeError, ValueError) as e:
            raise RequestError("Missing sketch id") from e

    def _sketch_content(self, request: dict) -> dict:
        """The sketch a request means: the one it carries, else the stored one named by sketch_id."""
        if isinstance(request.get("sketch"), dict):
            return request["sketch"]
        found = self._require_document().get_sketch(self._sketch_id(request))
        if found is None:
            raise RequestError("No such sketch")
        return found["sketch"]

    def _keep_entries(self, content: dict, request: dict) -> tuple[list, int]:
        """The document's sketch list with `content` stored in it (new, or replacing sketch_id), and its id."""
        document = self._require_document()
        entries = document.sketches
        if request.get("sketch_id") is None:
            sketch_id = document.new_sketch_id()
            name = str(request["name"]) if request.get("name") else f"Sketch {sketch_id}"
            entries.append({"id": sketch_id, "name": name, "rev": 1, "sketch": copy.deepcopy(content)})
        else:
            sketch_id = self._sketch_id(request)
            entry = next((e for e in entries if e["id"] == sketch_id), None)
            if entry is None:
                raise RequestError("No such sketch")
            entry["sketch"] = copy.deepcopy(content)
            entry["rev"] += 1
            if request.get("name"):
                entry["name"] = str(request["name"])
        return entries, sketch_id

    def _sketch_keep(self, request: dict) -> bytes:
        """Store a sketch in the document (new, or replacing `id`), optionally also making its faces, as one undo step."""
        document = self._require_document()
        content = request.get("sketch")
        if not isinstance(content, dict):
            raise RequestError("Missing sketch")
        start = time.perf_counter()
        make_faces = bool(request.get("regions"))
        made = 0
        shape = None
        if make_faces:
            try:
                closed = bool(sketch.regions(content))
            except (KeyError, TypeError, ValueError, sketch.SketchError) as e:
                raise RequestError(f"Malformed sketch request: {e!r}") from e
            if closed:  # an open path (a rail, a curve) is kept as it is and makes no faces
                shape, made = self._region_shape(request)
            else:
                make_faces = False
        timings = {"opMs": _ms(start)}
        entries, sketch_id = self._keep_entries(content, request)
        if make_faces:
            target = document.commit(shape, sketches=entries)
        else:
            target = document.set_sketches(entries)
        self._autosave()
        extra = {"preview": False, "sketchId": sketch_id}
        if bool(request.get("regions")):
            extra["facesMade"] = made
        if make_faces:
            extra["selection"] = Selection().to_json()
        return self._mesh_reply(target, timings, **extra)

    def _sketch_edit(self, request: dict, kind: str) -> bytes:
        document = self._require_document()
        sketch_id = self._sketch_id(request)
        entries = document.sketches
        entry = next((e for e in entries if e["id"] == sketch_id), None)
        if entry is None:
            raise RequestError("No such sketch")
        if kind == "sketch_delete":
            entries.remove(entry)
        else:
            name = str(request.get("name", "")).strip()
            if not name:
                raise RequestError("A sketch needs a name")
            entry["name"] = name
            entry["rev"] += 1
        target = document.set_sketches(entries)
        self._autosave()
        return self._mesh_reply(target, {}, preview=False)

    def _sketch_extrude(self, request: dict) -> bytes:
        document = self._require_document()
        commit = bool(request.get("commit"))
        start = time.perf_counter()
        content = self._sketch_content(request)
        try:
            if "axis" in request:  # revolve about a sketch line instead of extruding
                result = sketch.revolve(document.current.shape, content, int(request["axis"]), float(request["distance"]), str(request.get("mode", "new")))
            else:
                result = sketch.extrude(document.current.shape, content, float(request["distance"]), str(request.get("mode", "new")), bool(request.get("symmetric")))
        except (KeyError, TypeError, ValueError) as e:
            raise RequestError(f"Malformed sketch request: {e!r}") from e
        if document.mirror:
            result = mirror_result(document.current.shape, result, document.mirror["plane"])
        timings = {"opMs": _ms(start)}
        body_kind = "Revolution" if "axis" in request else "Extrusion"
        extra = {}
        if commit and request.get("keep") and isinstance(request.get("sketch"), dict):  # keep the sketch in the same undo step
            entries, sketch_id = self._keep_entries(content, request)
            target = document.commit(result.shape, body_kind, sketches=entries)
            extra["sketchId"] = sketch_id
        else:
            target = document.commit(result.shape, body_kind) if commit else document.preview(result.shape, body_kind)
        if commit:
            self._autosave()
        return self._mesh_reply(target, timings, preview=not commit, selection=Selection().to_json(), **extra)
