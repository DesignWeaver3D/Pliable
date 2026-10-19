/** On-screen manipulators (gizmos): the handles a tool declares (docs/protocol.md, Handles), drawn over the model and
 *  dragged with the left button. One handle sets one parameter; the host receives the new value while dragging.
 *  The maths that does not need a camera is exported for tests (`node --test app/tests`). */
import * as THREE from "three";
import { AXIS_COLORS } from "./axes.ts";
import type { HandleInfo } from "./tools";

/** Length of a handle's arm and the radius of its grab target, in screen pixels. */
export const ARM_PX = 34;
export const GRAB_PX = 9;
const COLOR = 0xffb347;
const COLOR_HOT = 0xffffff;
const COLOR_TOGGLE = 0x6fd3ff;
/** Resize grips are neutral squares (orange on hover) so they never read as the coloured move arrows. */
const COLOR_RESIZE = 0xc8ccd4;
const COLOR_RESIZE_HOT = 0xffb347;

/** The origin-axis colour of a direction (its largest component), or white-ish for none. */
export function axisColorOf(d: readonly number[]): number {
  const a = d.map(Math.abs);
  const k = a.indexOf(Math.max(...a));
  return [AXIS_COLORS.x, AXIS_COLORS.y, AXIS_COLORS.z][k];
}

/** The look of a handle: its resting and hover colour. */
export function handleColors(info: Pick<HandleInfo, "kind" | "toggle" | "direction">): { rest: number; hot: number } {
  if (info.toggle || info.kind === "toggle") return { rest: COLOR_TOGGLE, hot: COLOR_HOT };
  if (info.kind === "move") return { rest: axisColorOf(info.direction), hot: COLOR_HOT };
  if (info.kind === "resize") return { rest: COLOR_RESIZE, hot: COLOR_RESIZE_HOT };
  return { rest: COLOR, hot: COLOR_HOT };
}

/** The parameter value a handle shows after travelling `travel` (model units along the handle line). */
export function handleValue(h: Pick<HandleInfo, "value" | "scale" | "min"> & { max?: number | null }, travel: number): number {
  const v = h.value + h.scale * travel;
  if (h.min !== null && v < h.min) return h.min;
  if (h.max != null && v > h.max) return h.max;
  return v;
}

/** The values of a handle's linked parameters after travelling `travel`. */
export function linkedValues(h: Pick<HandleInfo, "links">, travel: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of h.links ?? []) out[l.param] = Math.round((l.value + l.scale * travel) * 1000) / 1000;
  return out;
}

/** The travel that gives `value` (inverse of handleValue; used to keep the handle where the clamp put it). */
export function travelFor(h: Pick<HandleInfo, "value" | "scale">, value: number): number {
  return h.scale === 0 ? 0 : (value - h.value) / h.scale;
}

/** The handle travel that a typed number asks for, or null while nothing usable is typed. A move arrow's number is the
 *  distance along its axis (negative goes backwards); any other handle's number is the parameter value itself (the size
 *  of a resize grip, a radius), with the handle's direction kept and the declared limits applied. */
export function typedTravel(h: Pick<HandleInfo, "value" | "scale" | "min" | "kind"> & { max?: number | null }, text: string, negative: boolean): number | null {
  const n = text === "" || text === "." ? NaN : Number(text);
  if (!Number.isFinite(n)) return null;
  const signed = negative ? -n : n;
  const raw = h.kind === "move" ? signed : travelFor(h, signed);
  return travelFor(h, handleValue(h, raw));
}

/** One key of typed entry: the new text and sign, or null when the key is not part of entry. A second "-" flips the sign back. */
export function typedStep(text: string | null, negative: boolean, key: string): { text: string; negative: boolean } | null {
  if (key === "-") return { text: text ?? "", negative: !negative };
  if (/^[0-9]$/.test(key)) return { text: (text ?? "") + key, negative };
  if (key === "." && !(text ?? "").includes(".")) return { text: (text ?? "") + ".", negative };
  if (key === "Backspace" && text !== null) return { text: text.slice(0, -1), negative };
  return null;
}

/** Where along the line (point p, unit direction d) the pointer ray passes closest, as a distance from p; null when the
 *  ray is nearly parallel to the line (looking along it), where the position is not defined. */
export function lineParam(p: THREE.Vector3, d: THREE.Vector3, rayOrigin: THREE.Vector3, rayDir: THREE.Vector3): number | null {
  const w = p.clone().sub(rayOrigin);
  const b = d.dot(rayDir);
  const denom = 1 - b * b;
  if (denom < 1e-4) return null;
  return (b * rayDir.dot(w) - d.dot(w)) / denom;
}

/** A value for a label: at most three decimals, no trailing zeros. */
export function formatValue(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

interface Item {
  info: HandleInfo;
  group: THREE.Group;
  tip: THREE.Mesh;
  arm: THREE.Line;
  label: HTMLElement;
  /** Travel from the declared anchor while this handle is being dragged. */
  travel: number;
}

interface Active {
  item: Item;
  t0: number;
  /** Fallback when the pointer ray is parallel to the handle's line: screen-space dragging from the press. */
  x: number;
  y: number;
  axisPx: THREE.Vector2;
  travel0: number;
  moved: boolean;
  lastX?: number;
  lastY?: number;
  /** Typed entry: the text so far (null while the mouse sets the value) and its sign. */
  typed: string | null;
  negative: boolean;
}

export class Manipulator {
  /** Called with the new parameter value while a handle is dragged, then once more with phase "end". */
  onDrag: (param: string, value: number, phase: "move" | "end" | "cancel", x: number, y: number, linked: Record<string, number>) => void = () => {};

  private readonly root = new THREE.Group();
  private items: Item[] = [];
  private hot: Item | null = null;
  private active: Active | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly layer: HTMLElement;
  private readonly ndc = new THREE.Vector2();

  private readonly camera: () => THREE.Camera;
  private readonly dom: HTMLElement;
  private readonly pixelSizeAt: (p: THREE.Vector3) => number;

  constructor(scene: THREE.Scene, camera: () => THREE.Camera, dom: HTMLElement, pixelSizeAt: (p: THREE.Vector3) => number) {
    this.camera = camera;
    this.dom = dom;
    this.pixelSizeAt = pixelSizeAt;
    this.root.renderOrder = 10;
    scene.add(this.root);
    this.layer = document.createElement("div");
    this.layer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden";
    const parent = dom.parentElement!;
    if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
    parent.append(this.layer);
  }

  get dragging(): boolean {
    return this.active !== null;
  }

  /** The handle being dragged right now, if any. */
  get dragInfo(): HandleInfo | null {
    return this.active?.item.info ?? null;
  }

  get count(): number {
    return this.items.length;
  }

  /** The handles now shown; a handle being dragged keeps its own position until the drag ends. */
  setHandles(handles: HandleInfo[]) {
    if (this.active) return;
    this.clear();
    for (const info of handles) {
      this.items.push(this.build(info));
    }
  }

  clear() {
    this.active = null;
    this.hot = null;
    for (const item of this.items) {
      this.root.remove(item.group);
      item.group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose();
      });
    }
    this.items = [];
    this.layer.replaceChildren();
    this.dom.style.cursor = "";
  }

  private build(info: HandleInfo): Item {
    const material = () => new THREE.MeshBasicMaterial({ color: handleColors(info).rest, depthTest: false, transparent: true });
    const group = new THREE.Group();
    group.renderOrder = 10;
    const dir = new THREE.Vector3(...info.direction);
    group.position.set(...info.anchor);
    const resize = info.kind === "resize" && !info.toggle;
    const geometry = info.toggle ? new THREE.SphereGeometry(0.17, 16, 12) : resize ? new THREE.BoxGeometry(0.3, 0.3, 0.3) : new THREE.ConeGeometry(0.16, 0.42, 16);
    const tip = new THREE.Mesh(geometry, material());
    tip.renderOrder = 11;
    if (resize) {
      tip.position.copy(dir).multiplyScalar(-0.15); // the grip sits on the anchor, with a thin stem back to the model
    } else if (!info.toggle) {
      tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      // The anchor is the grab point at the end of the arm; the arm runs back toward the model. A move arrow is the
      // opposite: it starts at its anchor (the point being moved) and points away along its axis, like an axis gizmo.
      tip.position.copy(dir).multiplyScalar(info.kind === "move" ? 0.79 : -0.21);
    }
    const arm = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), info.toggle ? new THREE.Vector3() : dir.clone().multiplyScalar(info.kind === "move" ? 1 : -1)]),
      new THREE.LineBasicMaterial({ color: handleColors(info).rest, depthTest: false, transparent: true }),
    );
    arm.renderOrder = 10;
    group.add(tip, arm);
    this.root.add(group);
    const label = document.createElement("div");
    label.style.cssText = "position:absolute;padding:1px 5px;border-radius:3px;background:rgba(20,20,24,.85);color:#ffd9a0;font:11px sans-serif;white-space:nowrap;transform:translate(10px,-50%)";
    this.layer.append(label);
    return { info, group, tip, arm, label, travel: 0 };
  }

  /** Per frame: keep handles a constant size on screen and put the value labels beside them. */
  update() {
    const rect = this.dom.getBoundingClientRect();
    for (const item of this.items) {
      const { info, group } = item;
      const pos = new THREE.Vector3(...info.anchor).addScaledVector(new THREE.Vector3(...info.direction), item.travel);
      group.position.copy(pos);
      const size = this.pixelSizeAt(pos) * ARM_PX;
      group.scale.setScalar(size);
      const hot = item === this.hot || item === this.active?.item;
      const colors = handleColors(info);
      const color = hot ? colors.hot : colors.rest;
      (item.tip.material as THREE.MeshBasicMaterial).color.setHex(color);
      (item.arm.material as THREE.LineBasicMaterial).color.setHex(color);
      group.scale.multiplyScalar(item === this.active?.item ? 1.3 : hot ? 1.15 : 1); // hovered and dragged handles grow
      const value = handleValue(info, item.travel);
      const p = pos.clone().project(this.camera());
      const behind = p.z > 1;
      item.label.style.display = behind || !hot ? "none" : "block"; // only the handle under the pointer or being dragged names itself
      item.label.style.left = `${((p.x + 1) / 2) * rect.width}px`;
      item.label.style.top = `${((1 - p.y) / 2) * rect.height}px`;
      const unit = info.unit === "Â°" || !info.unit ? info.unit : " " + info.unit;
      const typing = item === this.active?.item && this.active.typed !== null;
      const shown = typing ? `${this.active!.negative ? "-" : ""}${this.active!.typed}|` : formatValue(value);
      item.label.textContent = info.toggle ? info.label : `${info.label} ${shown}${unit}`;
      item.label.style.outline = typing ? "1px solid #ffb347" : "";
      item.label.style.fontWeight = hot ? "bold" : "normal";
    }
  }

  // ---- Pointer ------------------------------------------------------------------------------------------------

  private screen(p: THREE.Vector3): THREE.Vector2 {
    const rect = this.dom.getBoundingClientRect();
    const n = p.clone().project(this.camera());
    return new THREE.Vector2(((n.x + 1) / 2) * rect.width + rect.left, ((1 - n.y) / 2) * rect.height + rect.top);
  }

  private tipPoint(item: Item): THREE.Vector3 {
    return new THREE.Vector3(...item.info.anchor).addScaledVector(new THREE.Vector3(...item.info.direction), item.travel);
  }

  /** The handle under the pointer: the nearest one whose arm or tip is within the grab range. */
  hit(e: { clientX: number; clientY: number }): Item | null {
    const pointer = new THREE.Vector2(e.clientX, e.clientY);
    let best: Item | null = null;
    let bestD = GRAB_PX;
    for (const item of this.items) {
      const tip = this.tipPoint(item);
      const dir = new THREE.Vector3(...item.info.direction);
      const move = item.info.kind === "move";
      const reach = (move ? 1 : -1) * this.pixelSizeAt(tip) * ARM_PX;
      const end = item.info.toggle ? this.screen(tip) : this.screen(tip.clone().addScaledVector(dir, reach));
      // The arrowhead end wins ties: the tip of a pull arrow, the far end of a move arrow (all three start at one point).
      const a = move ? end : this.screen(tip);
      const b = move ? this.screen(tip) : end;
      const ab = b.clone().sub(a);
      const t = ab.lengthSq() < 1e-6 ? 0 : Math.max(0, Math.min(1, pointer.clone().sub(a).dot(ab) / ab.lengthSq()));
      const d = pointer.distanceTo(a.clone().addScaledVector(ab, t)) - (t === 0 ? 2 : 0); // the tip wins ties
      if (d < bestD) {
        bestD = d;
        best = item;
      }
    }
    return best;
  }

  /** Hover feedback; call on pointer movement while no button is down. */
  hover(e: { clientX: number; clientY: number }) {
    const hot = this.items.length ? this.hit(e) : null;
    if (hot !== this.hot) {
      this.hot = hot;
      this.dom.style.cursor = hot ? "grab" : "";
    }
  }

  private ray(e: { clientX: number; clientY: number }): THREE.Ray {
    const rect = this.dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera());
    return this.raycaster.ray;
  }

  /** Starts dragging the handle under the pointer; returns whether one was hit. */
  down(e: PointerEvent): boolean {
    const item = this.items.length ? this.hit(e) : null;
    if (!item) return false;
    const dir = new THREE.Vector3(...item.info.direction);
    const anchor = new THREE.Vector3(...item.info.anchor);
    const ray = this.ray(e);
    const t0 = lineParam(anchor, dir, ray.origin, ray.direction) ?? 0;
    const tip = this.tipPoint(item);
    const axisPx = this.screen(tip.clone().addScaledVector(dir, this.pixelSizeAt(tip) * ARM_PX)).sub(this.screen(tip));
    this.active = { item, t0: t0 - item.travel, x: e.clientX, y: e.clientY, axisPx, travel0: item.travel, moved: false, typed: null, negative: false };
    this.dom.style.cursor = "grabbing";
    (document.activeElement as HTMLElement | null)?.blur?.(); // typed digits belong to the handle, not to a form field that had focus
    return true;
  }

  /** The travel (model units from the declared anchor) the pointer asks for. */
  private travelAt(a: Active, e: { clientX: number; clientY: number }): number {
    const { info } = a.item;
    const ray = this.ray(e);
    const t = lineParam(new THREE.Vector3(...info.anchor), new THREE.Vector3(...info.direction), ray.origin, ray.direction);
    if (t !== null) return t - a.t0;
    // Looking along the handle's line: use the screen direction of a sideways drag instead.
    const length = this.pixelSizeAt(new THREE.Vector3(...info.anchor)) * ARM_PX;
    const axis = a.axisPx.lengthSq() < 4 ? new THREE.Vector2(0, -1) : a.axisPx.clone();
    const delta = new THREE.Vector2(e.clientX - a.x, e.clientY - a.y);
    return a.travel0 + (delta.dot(axis.normalize()) / ARM_PX) * length;
  }

  move(e: PointerEvent) {
    const a = this.active;
    if (!a || a.item.info.toggle) return; // a toggle is clicked, not dragged
    a.lastX = e.clientX;
    a.lastY = e.clientY;
    if (a.typed !== null) return; // a typed value holds the handle; the mouse is ignored
    a.moved = true;
    const value = handleValue(a.item.info, this.travelAt(a, e));
    a.item.travel = travelFor(a.item.info, value);
    this.onDrag(a.item.info.param, Math.round(value * 1000) / 1000, "move", e.clientX, e.clientY, linkedValues(a.item.info, a.item.travel));
  }

  /** Whether a number is being typed for the handle being dragged. */
  get typing(): boolean {
    return this.active?.typed != null;
  }

  /** Keyboard entry for the handle being dragged: digits, "." and "-" start typing at once, Backspace edits, Enter
   *  commits, Escape cancels the drag. Returns whether the key was used (the caller then prevents its default). */
  key(e: { key: string }): boolean {
    const a = this.active;
    if (!a || a.item.info.toggle) return false;
    if (e.key === "Enter") {
      this.finish();
      return true;
    }
    if (e.key === "Escape") {
      this.cancel();
      return true;
    }
    const step = typedStep(a.typed, a.negative, e.key);
    if (!step) return false;
    a.typed = step.text;
    a.negative = step.negative;
    const travel = typedTravel(a.item.info, a.typed, a.negative);
    if (travel !== null) {
      a.moved = true;
      this.setTravel(a, travel);
    }
    return true;
  }

  private setTravel(a: Active, travel: number) {
    a.item.travel = travel;
    const { info } = a.item;
    this.onDrag(info.param, Math.round(handleValue(info, travel) * 1000) / 1000, "move", a.lastX ?? a.x, a.lastY ?? a.y, linkedValues(info, travel));
  }

  /** Ends the drag as if the pointer was released (a typed value is committed). */
  finish() {
    const a = this.active;
    if (!a) return;
    this.release(a, a.lastX ?? a.x, a.lastY ?? a.y);
  }

  /** Abandons the drag, typed text included: the handle goes back where it started. */
  cancel() {
    const a = this.active;
    if (!a) return;
    this.active = null;
    this.dom.style.cursor = "";
    const { info } = a.item;
    a.item.travel = a.travel0;
    if (a.moved) this.onDrag(info.param, Math.round(handleValue(info, a.travel0) * 1000) / 1000, "cancel", a.lastX ?? a.x, a.lastY ?? a.y, linkedValues(info, a.travel0));
  }

  up(e: PointerEvent) {
    const a = this.active;
    if (!a) return;
    this.release(a, e.clientX, e.clientY);
  }

  private release(a: Active, x: number, y: number) {
    this.active = null;
    this.dom.style.cursor = "";
    const { info, travel } = a.item;
    const e = { clientX: x, clientY: y };
    if (info.toggle) {
      this.onDrag(info.param, info.value >= 0.5 ? 0 : 1, "end", e.clientX, e.clientY, {});
      return;
    }
    if (a.moved) this.onDrag(info.param, Math.round(handleValue(info, travel) * 1000) / 1000, "end", e.clientX, e.clientY, linkedValues(info, travel));
  }
}

