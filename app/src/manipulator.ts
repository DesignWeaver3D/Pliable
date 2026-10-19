/** On-screen manipulators (gizmos): the handles a tool declares (docs/protocol.md, Handles), drawn over the model and
 *  dragged with the left button. One handle sets one parameter; the host receives the new value while dragging.
 *  The maths that does not need a camera is exported for tests (`node --test app/tests`). */
import * as THREE from "three";
import type { HandleInfo } from "./tools";

/** Length of a handle's arm and the radius of its grab target, in screen pixels. */
export const ARM_PX = 34;
export const GRAB_PX = 9;
const COLOR = 0xffb347;
const COLOR_HOT = 0xffffff;

/** The parameter value a handle shows after travelling `travel` (model units for slide, degrees for turn). */
export function handleValue(h: Pick<HandleInfo, "value" | "scale" | "min">, travel: number): number {
  const v = h.value + h.scale * travel;
  return h.min !== null && v < h.min ? h.min : v;
}

/** The travel that gives `value` (inverse of handleValue; used to keep the handle where the clamp put it). */
export function travelFor(h: Pick<HandleInfo, "value" | "scale">, value: number): number {
  return h.scale === 0 ? 0 : (value - h.value) / h.scale;
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
}

export class Manipulator {
  /** Called with the new parameter value while a handle is dragged, then once more with phase "end". */
  onDrag: (param: string, value: number, phase: "move" | "end") => void = () => {};

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

  get count(): number {
    return this.items.length;
  }

  /** The handles now shown; a handle being dragged keeps its own position until the drag ends. */
  setHandles(handles: HandleInfo[]) {
    if (this.active) return;
    this.clear();
    for (const info of handles) {
      if (info.kind !== "slide") continue; // turn handles are drawn by the rotate tools (stage d)
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
    const material = () => new THREE.MeshBasicMaterial({ color: COLOR, depthTest: false, transparent: true });
    const group = new THREE.Group();
    group.renderOrder = 10;
    const dir = new THREE.Vector3(...info.direction);
    group.position.set(...info.anchor);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 16), material());
    tip.renderOrder = 11;
    tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    // The anchor is the grab point at the end of the arm; the arm runs back toward the model.
    tip.position.copy(dir).multiplyScalar(-0.21);
    const arm = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir.clone().multiplyScalar(-1)]),
      new THREE.LineBasicMaterial({ color: COLOR, depthTest: false, transparent: true }),
    );
    arm.renderOrder = 10;
    group.add(tip, arm);
    this.root.add(group);
    const label = document.createElement("div");
    label.style.cssText = "position:absolute;padding:1px 5px;border-radius:3px;background:rgba(20,20,24,.85);color:#ffd9a0;font:11px sans-serif;white-space:nowrap;transform:translate(10px,-50%)";
    this.layer.append(label);
    return { info, group, tip, arm, label, travel: 0 };
  }

  private unit(info: HandleInfo): string {
    return info.kind === "turn" ? "°" : " mm";
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
      (item.tip.material as THREE.MeshBasicMaterial).color.setHex(hot ? COLOR_HOT : COLOR);
      (item.arm.material as THREE.LineBasicMaterial).color.setHex(hot ? COLOR_HOT : COLOR);
      const value = handleValue(info, item.travel);
      const p = pos.clone().project(this.camera());
      const behind = p.z > 1;
      item.label.style.display = behind || !hot ? "none" : "block"; // only the handle under the pointer or being dragged names itself
      item.label.style.left = `${((p.x + 1) / 2) * rect.width}px`;
      item.label.style.top = `${((1 - p.y) / 2) * rect.height}px`;
      item.label.textContent = `${info.label} ${formatValue(value)}${this.unit(info)}`;
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
      const a = this.screen(tip);
      const dir = new THREE.Vector3(...item.info.direction);
      const b = this.screen(tip.clone().addScaledVector(dir, -this.pixelSizeAt(tip) * ARM_PX));
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
    this.active = { item, t0: t0 - item.travel, x: e.clientX, y: e.clientY, axisPx, travel0: item.travel, moved: false };
    this.dom.style.cursor = "grabbing";
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
    if (!a) return;
    a.moved = true;
    const value = handleValue(a.item.info, this.travelAt(a, e));
    a.item.travel = travelFor(a.item.info, value);
    this.onDrag(a.item.info.param, Math.round(value * 1000) / 1000, "move");
  }

  up(_e: PointerEvent) {
    const a = this.active;
    if (!a) return;
    this.active = null;
    this.dom.style.cursor = "";
    const { info, travel } = a.item;
    if (a.moved) this.onDrag(info.param, Math.round(handleValue(info, travel) * 1000) / 1000, "end");
  }
}
