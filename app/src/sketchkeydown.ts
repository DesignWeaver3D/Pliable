/** What a key press does in the sketch mode (after the key router has applied the shortcut policy). */
import * as M from "./sketchmodel.ts";
import * as Co from "./sketchcoincident.ts";
import { guard, leave } from "./sketchleave.ts";
import { endChain } from "./sketchpointer.ts";
import { pushUndo, undoStep } from "./sketchundo.ts";
import { cancelProjectPick, finishProjectPick } from "./sketchproject.ts";
import { resolveSketch } from "./sketchrefresh.ts";
import { renderSketch } from "./sketchrender.ts";
import type { SketchMode } from "./sketch.ts";

export function onKey(mode: SketchMode, e: KeyboardEvent) {
  if (!mode.active || mode.settingsDialog?.open || mode.leaveDialog?.open) return;
  const target = e.target as HTMLElement;
  if (target.closest("input, select, textarea")) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    e.stopImmediatePropagation();
    undoStep(mode, e.shiftKey ? "redo" : "undo");
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
    e.preventDefault();
    e.stopImmediatePropagation();
    undoStep(mode, "redo");
  } else if (mode.projectPick !== null && (e.key === "Escape" || e.key === "Enter")) {
    if (e.key === "Enter") void guard(mode, () => finishProjectPick(mode));
    else cancelProjectPick(mode);
  } else if (e.key === "Escape") {
    if (mode.chain.length) endChain(mode);
    else if (mode.tool !== "select") mode.setTool("select");
    else if (mode.selection.length || mode.selectedDimensions.size) mode.selection = [], mode.selectedDimensions.clear(), renderSketch(mode); // geometry, dimensions and marks alike
    else void leave(mode); // nothing left to cancel: leave the sketch (asking first if it holds work)
  } else if (e.key === "Enter" && mode.chain.length) {
    endChain(mode);
  } else if (e.key === "Enter" && mode.tool === "select" && mode.lastDrawTool && !mode.typed) {
    // Enter with no tool active starts the drawing tool used last again (as in other CAD programs).
    mode.setTool(mode.lastDrawTool);
  } else if ((e.key === "Delete" || e.key === "Backspace") && mode.selectedDimensions.size) {
    // Dimensions and constraint marks picked in the view (a click on a value or a mark) are deleted; the geometry they held stays, free of them.
    e.preventDefault();
    const ids = new Set(mode.selectedDimensions);
    pushUndo(mode);
    for (const id of ids) if (id < 0) mode.s = Co.splitPoint(mode.s, -id); // a joint's mark: letting go of it gives each curve its own end
    mode.s.constraints = mode.s.constraints.filter((c) => !ids.has(c.id));
    mode.selectedDimensions.clear();
    void resolveSketch(mode);
    renderSketch(mode);
    mode.host.status(`Deleted ${ids.size} constraint${ids.size === 1 ? "" : "s"} (Undo brings ${ids.size === 1 ? "it" : "them"} back)`);
  } else if ((e.key === "Delete" || e.key === "Backspace") && mode.selection.length) {
    // A box that took only some of a curve's points does not offer the curve for deletion: such a point is left out (a free point, or all of a curve's points, still counts).
    if (mode.selection === mode.boxSelection) {
      const chosen = new Set(mode.selection.map((x) => `${x.kind}:${x.id}`));
      const partial = (x: M.SketchSel) => x.kind === "point" && mode.s.entities.some((en) => M.entityPoints(en).includes(x.id)) && !mode.s.entities.some((en) => M.entityPoints(en).includes(x.id) && (chosen.has(`entity:${en.id}`) || M.entityPoints(en).every((pid) => chosen.has(`point:${pid}`))));
      mode.selection = mode.selection.filter((x) => !partial(x));
      if (!mode.selection.length) return mode.host.status("Only some points of the curves were boxed, so nothing was deleted (select the whole curve)");
    }
    // Only points selected and something holds them to other geometry: Delete lets go of that (the lines stay).
    const released = mode.selection.every((x) => x.kind === "point") ? Co.releasePoints(mode.s, mode.selection.map((x) => x.id)) : null;
    pushUndo(mode);
    if (released) {
      mode.s = released;
      mode.selection = [];
      resolveSketch(mode);
      renderSketch(mode);
      return mode.host.status("Removed the coincidence at the selected points; the lines stay");
    }
    for (const sel of mode.selection) {
      const axis = sel.kind === "entity" && sel.id === M.AXIS_U || sel.id === M.AXIS_V; // the sketch's own axes stay; the face edges and other projected geometry can be deleted
      if (!axis) mode.s = M.remove(mode.s, sel);
    }
    mode.selection = [];
    resolveSketch(mode);
    renderSketch(mode);
  }
}
