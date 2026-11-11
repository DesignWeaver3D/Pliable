/** Pointer and key handling of the 3D view: which press starts a gizmo, a tool drag, a hole move or a box selection, and what a release, a double-click or Escape does. */
import * as THREE from "three";
import { doubleClickBody } from "./bodylogic.ts";
import type { Kind } from "./viewport.ts";
import { pick, pickHit } from "./viewpick.ts";
import { clickOrProfile, curveUnder, profileUnder } from "./viewsketchpick.ts";
import { cancelBox, finishBox, updateBox, updateFilterBadge } from "./viewboxselect.ts";
import { closeSimilarMenu, openSimilarMenu } from "./viewsimilarmenu.ts";
import { clickSelect, isSelected, selectItems, setHover } from "./viewselection.ts";
import { drawMeasures, endMeasure, nearestMeasure } from "./viewdragmeasure.ts";
import { beginItemDrag, cancelDrag, dragDirection, dragDistance } from "./viewitemdrag.ts";
import { centreOffset, moveCentreDrag, startCentreDrag } from "./viewcentredrag.ts";
import { moveDivideDrag, startDivideDrag } from "./viewdividedrag.ts";
import type { Viewport } from "./viewport.ts";

/** The part of the Viewport this file uses. */
export type InputContext = Pick<Viewport, "box" | "boxEl" | "camera" | "centreDots" | "centreDrag" | "centresShown" | "controls" | "curveTargets" | "data" | "divideDrag" | "divideFrame" | "drag" | "dragReleased" | "eyedropper" | "faceStarts" | "filterBadge" | "ghostMaterial" | "ghosted" | "handleStartsItemDrag" | "heldKind" | "holdDrag" | "hoverLine" | "hoverMark" | "hovered" | "interceptor" | "lastClick" | "lastDistance" | "manipulator" | "markSource" | "measureAll" | "measureHot" | "measureHover" | "measureMode" | "measureSel" | "measures" | "mesh" | "model" | "onCentreDrag" | "onDivideDrag" | "onEdgeLoop" | "onEyedropCancel" | "onFaceBody" | "onHoverBody" | "onItemDrag" | "onMeasureChange" | "onProfileClick" | "onProfileHover" | "onSelect" | "onSketchCurveClick" | "onSketchDouble" | "originAxisHalf" | "pixelSizeAtDistance" | "primaryMeasure" | "probe" | "profileTargets" | "pullDirection" | "pullGizmo" | "raycaster" | "relatedMarks" | "renderer" | "rightDown" | "sectionClip" | "selected" | "selectedLine" | "selectedMarks" | "similarMenu" | "surfaceMaterial" | "toPixels" | "toolOpen">;

/** Attach the view's pointer, context-menu and key listeners. */
export function wireInput(view: InputContext) {
  const dom = view.renderer.domElement;
  let down: { x: number; y: number } | null = null;
  dom.addEventListener("pointerdown", (e) => {
    if (view.interceptor && e.button === 0) {
      // A sketch's plane handles are grabbed before the sketch tools see the press.
      if (view.manipulator.count && view.manipulator.down(e)) {
        dom.setPointerCapture(e.pointerId);
        return;
      }
      view.interceptor.down(e);
      return;
    }
    // The direction gizmo past the push/pull arrow: its pick icon and tilt arcs.
    if (e.button === 0 && !view.measureMode && !view.eyedropper && view.pullGizmo.down(e)) {
      dom.setPointerCapture(e.pointerId);
      return;
    }
    // The arrow handle of the selection's drag tool is a start point for the same drag as pressing the face itself.
    const handle = e.button === 0 && !view.measureMode ? view.manipulator.hit(e)?.info : undefined;
    if (handle && view.handleStartsItemDrag(handle)) {
      const anchor = new THREE.Vector3(...handle.anchor);
      const face = view.selected.find((s) => s.kind === "face");
      down = { x: e.clientX, y: e.clientY };
      beginItemDrag(view, e, new THREE.Vector3(...handle.direction), anchor, face ? face.id : null);
      dom.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 0 && view.manipulator.down(e)) {
      dom.setPointerCapture(e.pointerId);
      return;
    }
    down = { x: e.clientX, y: e.clientY };
    if (e.button !== 0 || view.measureMode || view.eyedropper) return;
    if (startCentreDrag(view, e) || startDivideDrag(view, e)) return;
    const reached = pickHit(view, e);
    // A tinted sketch region over a face of the model comes first: pressing it is a click on the region, not the start of a drag of the face under it (unless that face is already selected).
    const hit = reached?.kind === "face" && !isSelected(view, reached) && profileUnder(view, e) ? null : reached;
    view.box = null;
    // A chosen push/pull direction replaces the normal of the selected face being pressed (the arrow handle already carries it).
    const chosen = hit?.kind === "face" && view.pullDirection.dir && isSelected(view, hit) ? new THREE.Vector3(...view.pullDirection.dir) : null;
    const direction = chosen ?? (hit && dragDirection(view, hit));
    // Dragging the selected face or edge starts its tool instead of orbiting.
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    const shiftOnly = e.shiftKey && !e.ctrlKey && !e.metaKey; // Shift keeps the selection and drags symmetrically (push/pull)
    if (hit && direction && (!additive || shiftOnly) && !(view.toolOpen() && !isSelected(view, hit))) {
      // Pressing on an item selects it and starts its tool drag in one motion.
      if (!isSelected(view, hit)) {
        const sel = { kind: hit.kind, id: hit.id };
        selectItems(view, shiftOnly ? [...view.selected, sel] : [sel]);
        view.onSelect([sel]);
      }
      beginItemDrag(view, e, direction, hit.point, hit.kind === "face" ? hit.id : null);
      // Controls stay enabled: the left button is unmapped, so right-drag orbits and
      // middle-drag pans while the tool drag continues.
      dom.setPointerCapture(e.pointerId);
    } else {
      // Not starting a tool: a drag from here is a box selection.
      view.box = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, active: false, additive };
      dom.setPointerCapture(e.pointerId);
    }
  });
  dom.addEventListener("pointermove", (e) => {
    if (view.divideDrag) {
      moveDivideDrag(view, e);
      return;
    }
    if (view.centreDrag) {
      moveCentreDrag(view, e);
      return;
    }
    if (view.box) {
      updateBox(view, e);
      return;
    }
    if (view.pullGizmo.dragging) {
      view.pullGizmo.move(e);
      return;
    }
    if (view.manipulator.dragging) {
      view.manipulator.move(e);
      return;
    }
    if (view.interceptor) {
      view.interceptor.move(e);
      if (e.buttons === 0 && view.manipulator.count) view.manipulator.hover(e);
      return;
    }
    if (e.buttons === 0 && !view.drag && !view.pullGizmo.hover(e)) view.manipulator.hover(e);
    if (view.drag && e.buttons === 0 && !view.holdDrag && !view.measureMode) {
      // The button went up without this view seeing it (released in measure mode, then left with Escape): the drag is dead.
      // Left set, it blocks the measurement card and the other keys until the page is reloaded.
      cancelDrag(view);
      return;
    }
    if (view.drag) {
      if (view.measureMode) {
        view.measureHover = nearestMeasure(view, e);
        drawMeasures(view, view.lastDistance);
      }
      if (view.holdDrag) return;
      const distance = dragDistance(view, e);
      if (view.drag.moved || Math.hypot(e.clientX - view.drag.x, e.clientY - view.drag.y) >= 4) {
        view.drag.moved = true;
        drawMeasures(view, distance);
        view.onItemDrag(view.drag.sels, distance, "move", e.clientX, e.clientY);
      }
    } else if (e.buttons === 0) {
      // A sketch region drawn over a face of the model has the priority: the face is not lit then.
      const sel = pick(view, e);
      const region = !sel || sel.kind === "face" ? profileUnder(view, e) : null;
      setHover(view, region ? null : sel);
      if (region) view.renderer.domElement.style.cursor = "pointer";
      view.onProfileHover(region, !sel || sel.kind === "face" ? curveUnder(view, e) : null);
    }
  });
  dom.addEventListener("pointerdown", (e) => {
    if (e.button === 2) view.rightDown = { x: e.clientX, y: e.clientY };
  });
  dom.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    // A right click that did not orbit or pan, with one face or edge selected, offers to select its likes.
    const down = view.rightDown;
    view.rightDown = null;
    if (!view.interceptor && down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) openSimilarMenu(view, e.clientX, e.clientY);
  });
  const heldKey = (e: KeyboardEvent) => ({ f: "face", e: "edge", v: "vertex" } as Record<string, Kind>)[e.key.toLowerCase()];
  window.addEventListener(
    "keydown",
    (e) => {
      const kind = heldKey(e);
      if (!kind || !view.box || e.ctrlKey || e.metaKey || e.altKey) return;
      e.stopImmediatePropagation(); // while a box is being dragged these keys choose what it selects, not a tool shortcut
      view.heldKind = kind;
      updateFilterBadge(view);
    },
    true,
  );
  window.addEventListener(
    "keyup",
    (e) => {
      if (!heldKey(e) || !view.heldKind) return;
      view.heldKind = null;
      updateFilterBadge(view);
    },
    true,
  );
  window.addEventListener("pointerdown", (e) => {
    if (view.similarMenu && !view.similarMenu.contains(e.target as Node)) closeSimilarMenu(view);
  });
  dom.addEventListener("pointerleave", () => {
    setHover(view, null);
    view.onProfileHover(null, null);
  });
  dom.addEventListener("dblclick", (e) => {
    if (view.interceptor) return;
    if (view.measureMode) return; // a double-click on a measure candidate is only a pick: it must not start a fillet or chamfer on that edge
    const hit = pickHit(view, e as PointerEvent);
    if (hit?.kind === "edge") view.onEdgeLoop(hit.id, e.ctrlKey || e.metaKey);
    const sketchId = !hit || hit.kind === "face" ? (curveUnder(view, e) ?? profileUnder(view, e as PointerEvent)?.id ?? null) : null;
    if (sketchId !== null) return view.onSketchDouble(sketchId); // the whole sketch, whatever lies behind it
    const body = doubleClickBody(hit, (id) => view.data?.faces.find((f) => f.id === id)?.body);
    if (body !== null) view.onFaceBody(body);
  });
  dom.addEventListener("pointerup", (e) => {
    if (view.pullGizmo.dragging && e.button === 0) {
      view.pullGizmo.up();
      return;
    }
    if (view.manipulator.dragging && e.button === 0) {
      view.manipulator.up(e);
      return;
    }
    if (view.interceptor && e.button === 0) {
      view.interceptor.up(e);
      return;
    }
    if (view.drag && e.button !== 0) return; // right/middle release ends an orbit or pan, not the tool drag
    const drag = view.drag;
    if (view.divideDrag && e.button === 0) {
      const d = view.divideDrag;
      view.divideDrag = null;
      if (d.across !== null) view.onDivideDrag(d.across, d.offset, true);
      down = null;
      return;
    }
    if (view.centreDrag && e.button === 0) {
      const c = view.centreDrag;
      view.centreDrag = null;
      if (c.moved) {
        view.onCentreDrag(c.face, centreOffset(view, e, c), "end");
        down = null;
      } else {
        clickSelect(view, { kind: "face", id: c.face, centre: true }, e.ctrlKey || e.metaKey || e.shiftKey);
        down = null;
      }
      return;
    }
    if (view.eyedropper && e.button === 0) {
      const sel = pick(view, e);
      if (sel) view.eyedropper(sel);
      down = null;
      return;
    }
    if (view.box) {
      finishBox(view, e);
      down = null;
      return;
    }
    if (drag && view.measureMode) {
      // Measure mode keeps the drag open: a click picks the edge to edit.
      const picked = nearestMeasure(view, e);
      if (picked && picked !== view.measureSel) {
        view.measureSel = picked;
        drawMeasures(view, view.lastDistance);
        view.onMeasureChange();
      }
      down = null;
      return;
    }
    if (drag && view.holdDrag && e.button === 0) {
      view.dragReleased = true; // a typed value overrides the drag: Enter commits, Escape cancels
      return;
    }
    if (drag) {
      endMeasure(view);
      view.drag = null;
      view.holdDrag = false;
      if (drag.moved) {
        view.onItemDrag(drag.sels, dragDistance(view, e, drag), "end");
        down = null;
        return;
      }
    }
    // A click, not the end of an orbit/pan drag.
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4 && e.button === 0) {
      clickOrProfile(view, e, e.ctrlKey || e.metaKey || e.shiftKey);
    }
    down = null;
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && view.similarMenu) closeSimilarMenu(view);
    if (e.key === "Escape" && view.box) cancelBox(view);
    if (e.key === "Escape" && view.divideDrag) view.divideDrag = null;
    if (e.key === "Escape" && view.centreDrag) {
      const c = view.centreDrag;
      view.centreDrag = null;
      if (c.moved) view.onCentreDrag(c.face, new THREE.Vector3(), "cancel");
    }
    if (e.key === "Escape" && view.eyedropper) view.onEyedropCancel();
    if (e.key === "Escape" && view.drag && !view.holdDrag) {
      const sels = view.drag.sels;
      view.drag = null;
      view.holdDrag = false;
      endMeasure(view);
      view.onItemDrag(sels, 0, "cancel");
    }
  });
}
