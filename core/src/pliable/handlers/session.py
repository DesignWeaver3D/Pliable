"""Session methods for opening, resuming and restoring a model, and the diagnostics and notice requests."""

from OCP.TopoDS import TopoDS_Compound

from .. import __version__, diagnostics, notice
from ..demos import load_demo
from .common import RequestError

# The document of the connection that dropped last, kept so the page can pick it up again after reconnecting.
_parked: dict = {"document": None}


class SessionHandlers:
    """Session methods for opening, resuming and restoring a model, and the diagnostics and notice requests."""

    def _hello(self, request):
        reply = {"version": __version__}
        parked = _parked["document"]
        if parked is not None:  # a tab closed or refreshed on this core: its model comes back before any crash restore is offered
            reply["resume"] = {"name": parked.name}
        elif self.unclean:
            reply["restore"] = self.unclean
        return reply

    def _resume_session(self, request):
        document, _parked["document"] = _parked["document"], None
        if document is None:
            raise RequestError("Nothing to resume")
        self.document = document
        self._autosave(fresh=True)
        return self._mesh_reply(document.current, {}, name=document.name)

    def _restore_session(self, request):
        document = self.autosaver.restore() if self.autosaver else None
        if document is None:
            raise RequestError("Nothing to restore")
        self.document = document
        self.unclean = None
        self._autosave(fresh=True)
        return self._mesh_reply(document.current, {}, name=document.name)

    def _open_demo(self, request):
        return self._open(load_demo(request["name"]), request["name"])

    def _new_project(self, request):
        return self._open(TopoDS_Compound(), "Untitled")

    def _diagnostics(self, request):
        return {"report": diagnostics.core_report(self.last_tool, self.import_warnings, self.usage.report(), self._model_summary())}

    def _usage_event(self, request):
        self.usage.record(request.get("tool"), request.get("event"), request.get("surface"))
        return {}

    def _notice_get(self, request):
        return {"acknowledged": notice.acknowledged(), "epoch": notice.NOTICE_EPOCH}

    def _notice_ack(self, request):
        notice.acknowledge()
        return {"acknowledged": True, "epoch": notice.NOTICE_EPOCH}

    def _usage_clear(self, request):
        self.usage.clear()
        return {}

    def _undo_redo(self, request, kind):
        document = self._require_document()
        changed = document.undo() if kind == "undo" else document.redo()
        if not changed:
            raise RequestError(f"Nothing to {kind}")
        self._autosave()
        return self._mesh_reply(document.current, {})
