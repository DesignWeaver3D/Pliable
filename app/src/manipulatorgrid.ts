/** The grid grip of an array tool: dragging it or typing sets the column and row counts. */
import type { Active, Item } from "./manipulator.ts";
import * as THREE from "three";
import type { HandleInfo } from "./tools.ts";
import { gridCounts, gridShift, planePoint } from "./gridgrip.ts";
import { TypedFields, typedCounts } from "./typedentry.ts";
import { cancelHandle, finishHandle } from "./manipulatordrag.ts";
import type { Manipulator } from "./manipulator.ts";

/** The part of the Manipulator this file uses. */
export type HandleGridContext = Pick<Manipulator, "active" | "dom" | "hit" | "items" | "onDrag" | "pixelSizeAt" | "ray" | "screen" | "tipPoint">;

/** The counts of a grid grip (its parameter and its first linked one) as the grip was computed. */
export function gridStart(manip: HandleGridContext, info: HandleInfo): { columns: number; rows: number } {
  return { columns: info.value, rows: info.links?.[0]?.value ?? 1 };
}

/** A grid grip follows the pointer in the plane of the steps and asks for whole columns and rows, independently. */
export function moveGrid(manip: HandleGridContext, a: Active, e: { clientX: number; clientY: number }) {
  const { item } = a;
  const { info } = item;
  if (!info.plane || !a.p0) return;
  const ray = manip.ray(e);
  const p = planePoint(ray.origin.toArray(), ray.direction.toArray(), info.anchor, info.plane[0], info.plane[1]);
  if (!p) return;
  const [u, v] = info.plane;
  const start = gridStart(manip, info);
  const delta = new THREE.Vector3(...p).sub(a.p0);
  const now = gridCounts(delta.toArray(), u, v, start.columns, start.rows, info.min ?? 1);
  a.moved = true;
  item.grid = now;
  item.shift.set(...gridShift(u, v, now.columns, now.rows, start.columns, start.rows));
  const rowsParam = info.links?.[0]?.param;
  manip.onDrag(info.param, now.columns, "move", e.clientX, e.clientY, rowsParam ? { [rowsParam]: now.rows } : {});
}

/** Typed entry for a grid grip: digits set the columns, Tab moves to the rows, Enter commits (whole numbers, at least 1), Escape goes back to the mouse, then cancels. */
export function gridKey(manip: HandleGridContext, a: Active, e: { key: string }): boolean {
  const item = a.item;
  if (e.key === "Enter") {
    if (a.fields) {
      item.grid = typedCounts(a.fields, item.grid ?? gridStart(manip, item.info));
      applyGrid(manip, item);
      a.moved = true;
    }
    finishHandle(manip);
    return true;
  }
  if (e.key === "Escape") {
    if (a.fields && !a.released) {
      a.fields = null; // button still held: back to dragging
      a.typed = null;
      return true;
    }
    cancelHandle(manip);
    return true;
  }
  const fields = a.fields ?? new TypedFields(2, true);
  if (!fields.key(e.key)) return false;
  a.fields = fields;
  a.typed = ""; // the mouse is ignored while the numbers are typed (see move)
  return true;
}

/** Put a grid grip where its counts say, and tell the form. */
export function applyGrid(manip: HandleGridContext, item: Item) {
  const info = item.info;
  const now = item.grid;
  if (!info.plane || !now) return;
  const start = gridStart(manip, info);
  item.shift.set(...gridShift(info.plane[0], info.plane[1], now.columns, now.rows, start.columns, start.rows));
  const rowsParam = info.links?.[0]?.param;
  manip.onDrag(info.param, now.columns, "move", manip.active?.lastX ?? 0, manip.active?.lastY ?? 0, rowsParam ? { [rowsParam]: now.rows } : {});
}
