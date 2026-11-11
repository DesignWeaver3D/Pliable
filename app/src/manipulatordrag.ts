/** Dragging a handle: press, move, typed value entry, release, finish and cancel. */
import type { Active } from "./manipulator.ts";
import * as THREE from "three";
import { planePoint } from "./gridgrip.ts";
import { ARM_PX, handleValue, snapValue, linkedValues, travelFor, typedTravel, typedStep, lineParam } from "./handlemath.ts";
import { roundValue } from "./precision.ts";
import { pieAngleAt } from "./piegizmo.ts";
import { gridKey, gridStart, moveGrid } from "./manipulatorgrid.ts";
import type { Manipulator } from "./manipulator.ts";

/** The part of the Manipulator this file uses. */
export type HandleDragContext = Pick<Manipulator, "active" | "dom" | "hit" | "items" | "onDrag" | "pixelSizeAt" | "ray" | "screen" | "tipPoint">;

/** Starts dragging the handle under the pointer; returns whether one was hit. */
export function handleDown(manip: HandleDragContext, e: PointerEvent): boolean {
  const item = manip.items.length ? manip.hit(e) : null;
  if (!item) return false;
  const dir = new THREE.Vector3(...item.info.direction);
  const anchor = new THREE.Vector3(...item.info.anchor);
  const ray = manip.ray(e);
  const t0 = lineParam(anchor, dir, ray.origin, ray.direction) ?? 0;
  const tip = manip.tipPoint(item);
  const axisPx = manip.screen(tip.clone().addScaledVector(dir, manip.pixelSizeAt(tip) * ARM_PX)).sub(manip.screen(tip));
  manip.active = { item, t0: t0 - item.travel, x: e.clientX, y: e.clientY, axisPx, travel0: item.travel, moved: false, typed: null, negative: false };
  if (item.info.plane) {
    const [u, v] = item.info.plane;
    const p = planePoint(ray.origin.toArray(), ray.direction.toArray(), item.info.anchor, u, v);
    manip.active.p0 = p ? new THREE.Vector3(...p) : undefined;
  }
  manip.dom.style.cursor = "grabbing";
  (document.activeElement as HTMLElement | null)?.blur?.(); // typed digits belong to the handle, not to a form field that had focus
  return true;
}

/** The travel (model units from the declared anchor) the pointer asks for. */
export function travelAt(manip: HandleDragContext, a: Active, e: { clientX: number; clientY: number }): number {
  const { info } = a.item;
  const ray = manip.ray(e);
  if (info.pie) {
    const degrees = pieAngleAt(info, ray.origin, ray.direction, handleValue(info, a.item.travel));
    if (degrees !== null) return travelFor(info, degrees);
  }
  const t = lineParam(new THREE.Vector3(...info.anchor), new THREE.Vector3(...info.direction), ray.origin, ray.direction);
  if (t !== null) return t - a.t0;
  // Looking along the handle's line: use the screen direction of a sideways drag instead.
  const length = manip.pixelSizeAt(new THREE.Vector3(...info.anchor)) * ARM_PX;
  const axis = a.axisPx.lengthSq() < 4 ? new THREE.Vector2(0, -1) : a.axisPx.clone();
  const delta = new THREE.Vector2(e.clientX - a.x, e.clientY - a.y);
  return a.travel0 + (delta.dot(axis.normalize()) / ARM_PX) * length;
}

export function handleMove(manip: HandleDragContext, e: PointerEvent) {
  const a = manip.active;
  if (!a || a.item.info.toggle) return; // a toggle is clicked, not dragged
  a.lastX = e.clientX;
  a.lastY = e.clientY;
  if (a.typed !== null) return; // a typed value holds the handle; the mouse is ignored
  if (a.item.info.plane) {
    moveGrid(manip, a, e);
    return;
  }
  a.moved = true;
  const value = snapValue(handleValue(a.item.info, travelAt(manip, a, e)), a.item.info.snaps);
  a.item.travel = travelFor(a.item.info, value);
  manip.onDrag(a.item.info.param, roundValue(value), "move", e.clientX, e.clientY, linkedValues(a.item.info, a.item.travel));
}

/** Keyboard entry for the handle being dragged: digits, "." and "-" start typing at once, Backspace edits, Enter
 *  commits, Escape cancels the drag. Returns whether the key was used (the caller then prevents its default). */
export function handleKey(manip: HandleDragContext, e: { key: string }): boolean {
  const a = manip.active;
  if (!a || a.item.info.toggle) return false;
  if (a.item.info.plane) return gridKey(manip, a, e);
  if (e.key === "Enter") {
    // The typed value is applied only now; while typing, only the label shows it and the shape stays put.
    const travel = a.typed === null ? null : typedTravel(a.item.info, a.typed, a.negative);
    if (travel !== null) {
      a.moved = true;
      setTravel(manip, a, travel);
    }
    finishHandle(manip);
    return true;
  }
  if (e.key === "Escape") {
    if (a.typed !== null && !a.released) {
      a.typed = null; // button still held: back to dragging
      a.negative = false;
      return true;
    }
    cancelHandle(manip);
    return true;
  }
  // Typing starts from the direction the drag already chose: a face pushed in (negative) stays negative.
  if (a.typed === null && typedStep(null, false, e.key)) {
    const now = a.item.info.kind === "move" ? a.item.travel : handleValue(a.item.info, a.item.travel);
    a.negative = now < 0;
  }
  const step = typedStep(a.typed, a.negative, e.key);
  if (!step) return false;
  a.typed = step.text;
  a.negative = step.negative;
  return true;
}

export function setTravel(manip: HandleDragContext, a: Active, travel: number) {
  a.item.travel = travel;
  const { info } = a.item;
  manip.onDrag(info.param, roundValue(handleValue(info, travel)), "move", a.lastX ?? a.x, a.lastY ?? a.y, linkedValues(info, travel));
}

/** Ends the drag as if the pointer was released (a typed value is committed). */
export function finishHandle(manip: HandleDragContext) {
  const a = manip.active;
  if (!a) return;
  releaseHandle(manip, a, a.lastX ?? a.x, a.lastY ?? a.y);
}

/** Abandons the drag, typed text included: the handle goes back where it started. */
export function cancelHandle(manip: HandleDragContext) {
  const a = manip.active;
  if (!a) return;
  manip.active = null;
  manip.dom.style.cursor = "";
  const { info } = a.item;
  a.item.travel = a.travel0;
  if (info.plane) {
    a.item.shift.set(0, 0, 0);
    a.item.grid = undefined;
    const start = gridStart(manip, info);
    const rowsParam = info.links?.[0]?.param;
    if (a.moved) manip.onDrag(info.param, start.columns, "cancel", a.lastX ?? a.x, a.lastY ?? a.y, rowsParam ? { [rowsParam]: start.rows } : {});
    return;
  }
  if (a.moved) manip.onDrag(info.param, roundValue(handleValue(info, a.travel0)), "cancel", a.lastX ?? a.x, a.lastY ?? a.y, linkedValues(info, a.travel0));
}

export function handleUp(manip: HandleDragContext, e: PointerEvent) {
  const a = manip.active;
  if (!a) return;
  if (a.typed !== null) {
    a.released = true; // typing overrides the drag: the button may be let go, Enter commits and Escape cancels
    return;
  }
  releaseHandle(manip, a, e.clientX, e.clientY);
}

export function releaseHandle(manip: HandleDragContext, a: Active, x: number, y: number) {
  manip.active = null;
  manip.dom.style.cursor = "";
  const { info, travel } = a.item;
  const e = { clientX: x, clientY: y };
  if (info.toggle) {
    manip.onDrag(info.param, info.value >= 0.5 ? 0 : 1, "end", e.clientX, e.clientY, {});
    return;
  }
  if (info.plane) {
    const now = a.item.grid;
    const rowsParam = info.links?.[0]?.param;
    if (a.moved && now) manip.onDrag(info.param, now.columns, "end", e.clientX, e.clientY, rowsParam ? { [rowsParam]: now.rows } : {});
    return;
  }
  if (a.moved) manip.onDrag(info.param, roundValue(handleValue(info, travel)), "end", e.clientX, e.clientY, linkedValues(info, travel));
}
