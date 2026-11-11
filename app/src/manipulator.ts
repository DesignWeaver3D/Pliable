/** On-screen manipulators (gizmos): the handles a tool declares (docs/protocol.md, Handles), drawn over the model and
 *  dragged with the left button. One handle sets one parameter; the host receives the new value while dragging.
 *  The maths that does not need a camera is exported for tests (`node --test app/tests`). */
import * as THREE from "three";
import type { HandleInfo } from "./tools.ts";
import { TypedFields } from "./typedentry.ts";
import { projectOnSegment } from "./segmentmath.ts";
import { mirrorEnd, segmentPx } from "./pushpullhit.ts";
import { ARM_PX, GRAB_PX, PUSH_PULL_ARM_RATIO, isPushPullArrow, MOVE_ARM_PX, pickScore, grabFraction, handleColors, handleValue, typedShown, formatValue, ARC_RADIUS_PX, ARC_REST_OPACITY, COLOR_SNAPPED, snappedIndex, RING_VIEW_FRACTION, refitRing } from "./handlemath.ts";
import { piePoint } from "./piegizmo.ts";
import { arcDistance, buildHandle, drawPie, reaim, turnArc } from "./manipulatorbuild.ts";
import { gridStart } from "./manipulatorgrid.ts";
import { cancelHandle, finishHandle, handleDown, handleKey, handleMove, handleUp } from "./manipulatordrag.ts";
export * from "./handlemath.ts"; // the maths moved to its own file; the tests and other modules still import it from here

export interface Item {
  info: HandleInfo;
  /** A rotation handle as the tool declared it, before its ring was fitted to the view. */
  declared?: HandleInfo;
  group: THREE.Group;
  tip: THREE.Mesh;
  arm: THREE.Line;
  /** An axis handle's line from its far end back to `info.axisFrom`, with a dot at that end (not grabbable). */
  axis?: THREE.Group;
  label: HTMLElement;
  /** An arrow another handle turns: the direction it was built with. */
  baseDirection?: THREE.Vector3;
  /** Travel from the declared anchor while this handle is being dragged. */
  travel: number;
  /** A grid grip: how far the drag moved it from its anchor, and the counts it now asks for. */
  shift: THREE.Vector3;
  grid?: { columns: number; rows: number };
}

export interface Active {
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
  /** The button was let go while a typed value held the handle. */
  released?: boolean;
  negative: boolean;
  /** A grid grip: where the pointer first met the plane of the steps. */
  p0?: THREE.Vector3;
  /** A grid grip's typed entry: columns, then rows (Tab switches); null while the mouse sets them. */
  fields?: TypedFields | null;
}

function dispose(o: THREE.Object3D) {
  const m = o as THREE.Mesh;
  m.geometry?.dispose();
  (m.material as THREE.Material | undefined)?.dispose();
}

export class Manipulator {
  /** Called with the new parameter value while a handle is dragged, then once more with phase "end". */
  onDrag: (param: string, value: number, phase: "move" | "end" | "cancel", x: number, y: number, linked: Record<string, number>) => void = () => {};

  /** The color of the push/pull arrow at rest, when something else decides it (Flip turns it red, see pushpullarrows.ts); null: the handle's own color. */
  pushPullRest: number | null = null;
  /** Set while a point is being picked: the handles and their labels are neither drawn nor grabbed (see Viewport.setGizmosHidden). */
  hidden = false;

  readonly root = new THREE.Group();
  items: Item[] = [];
  private hot: Item | null = null;
  active: Active | null = null;
  private readonly raycaster = new THREE.Raycaster();
  readonly layer: HTMLElement;
  private readonly ndc = new THREE.Vector2();

  private readonly camera: () => THREE.Camera;
  readonly dom: HTMLElement;
  readonly pixelSizeAt: (p: THREE.Vector3) => number;

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

  /** Whether a handle for this parameter is shown. */
  has(param: string): boolean {
    return this.items.some((i) => i.info.param === param);
  }

  get count(): number {
    return this.items.length;
  }

  /** The push/pull arrow as it stands now (where it starts and which way it points), for the direction gizmo that sits past its head. */
  pushPullHandle(): { anchor: [number, number, number]; direction: [number, number, number]; frame: [[number, number, number], [number, number, number]] | null } | null {
    const item = this.items.find((i) => i.info.param === "distance" && i.info.label === "Push/pull");
    return item ? { anchor: item.info.anchor, direction: item.info.direction, frame: item.info.frame ?? null } : null;
  }

  /** The handles now shown; a handle being dragged keeps its own position until the drag ends. */
  setHandles(handles: HandleInfo[]) {
    if (this.active) return;
    this.clear();
    for (const info of handles) {
      this.items.push(buildHandle(this, info));
    }
  }

  clear() {
    this.active = null;
    this.hot = null;
    for (const item of this.items) {
      this.root.remove(item.group);
      if (item.axis) this.root.remove(item.axis);
      item.axis?.traverse(dispose);
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

  /** Per frame: keep handles a constant size on screen and put the value labels beside them. */
  update() {
    this.root.visible = !this.hidden;
    this.layer.style.display = this.hidden ? "none" : "";
    const rect = this.dom.getBoundingClientRect();
    for (const item of this.items) {
      if (item.declared?.ring && item.axis && item !== this.active?.item) {
        // A rotation ring is a fixed share of the view's short side, whatever the zoom; the grip stays on it.
        const [cx, cy, cz] = item.declared.ring;
        const centre = new THREE.Vector3(cx, cy, cz);
        const radius = item.declared.arc ? this.pixelSizeAt(centre) * ARC_RADIUS_PX : (this.pixelSizeAt(centre) * Math.min(rect.width, rect.height) * RING_VIEW_FRACTION) / 2;
        if (radius > 0) {
          const fit = refitRing(item.declared.ring, item.declared.anchor, item.declared.scale, radius);
          item.info.ring = fit.ring as typeof item.info.ring;
          item.info.anchor = fit.anchor as typeof item.info.anchor;
          item.info.scale = fit.scale;
          item.axis.scale.setScalar(radius / item.declared.ring[3]);
        }
      }
      if (item.declared?.arc && item.axis) turnArc(this, item);
      if (item.baseDirection && this.active?.item.info.arc && this.active.item.info.param === item.info.turnedBy) reaim(this, item, this.active.item);
      const { info, group } = item;
      const pos = this.tipPoint(item);
      group.position.copy(pos);
      if (info.pie && item.axis) drawPie(this, item);
      if (item.axis && info.axisFrom) {
        const from = new THREE.Vector3(...info.axisFrom);
        const line = item.axis.children[0] as THREE.Line;
        line.geometry.setFromPoints([from, pos]);
        item.axis.children[1].position.copy(from);
        item.axis.children[1].scale.setScalar(info.arrowhead ? 0 : this.pixelSizeAt(from) * 4); // a dimension line has no dot at its start
        if (info.extension) {
          // Extension lines at both ends of a dimension line, each running by the vector `extension` (back in to the measured profile).
          const out = new THREE.Vector3(...info.extension);
          (item.axis.children[2] as THREE.LineSegments).geometry.setFromPoints([from, from.clone().add(out), pos, pos.clone().add(out)]);
        }
      }
      const size = this.pixelSizeAt(pos) * ARM_PX;
      group.scale.setScalar(size);
      if (info.kind === "move") {
        const ratio = MOVE_ARM_PX / ARM_PX;
        const dir = new THREE.Vector3(...info.direction);
        item.arm.scale.setScalar(ratio);
        item.tip.position.copy(dir).multiplyScalar(ratio - 0.21);
      } else if (isPushPullArrow(info)) {
        const dir = new THREE.Vector3(...info.direction);
        item.arm.scale.setScalar(PUSH_PULL_ARM_RATIO);
        item.tip.position.copy(dir).multiplyScalar(PUSH_PULL_ARM_RATIO - 0.21);
      }
      const hot = item === this.hot || item === this.active?.item;
      const colors = handleColors(info);
      const color = hot ? colors.hot : isPushPullArrow(info) && this.pushPullRest !== null ? this.pushPullRest : colors.rest;
      (item.tip.material as THREE.MeshBasicMaterial).color.setHex(color);
      (item.arm.material as THREE.LineBasicMaterial).color.setHex(color);
      const snapped = info.arc ? snappedIndex(handleValue(info, item.travel), info.snaps) : -1;
      if (info.arc && item.axis) {
        const arc = item.axis.children[0] as THREE.Line;
        (arc.material as THREE.LineBasicMaterial).color.setHex(snapped >= 0 ? COLOR_SNAPPED : color);
        (arc.material as THREE.LineBasicMaterial).opacity = hot ? 1 : ARC_REST_OPACITY;
      }
      group.scale.multiplyScalar(item === this.active?.item ? 1.3 : hot ? 1.15 : 1); // hovered and dragged handles grow
      const value = handleValue(info, item.travel);
      const p = pos.clone().project(this.camera());
      const behind = p.z > 1;
      item.label.style.display = behind || (!hot && !info.pie && !info.badge && !info.arrowhead) ? "none" : "block"; // only the handle under the pointer or being dragged names itself (a pie angle and a count always show their value)
      const middle = info.arrowhead && info.axisFrom ? new THREE.Vector3(...info.axisFrom).add(pos).multiplyScalar(0.5).project(this.camera()) : null;
      const at = middle ?? (info.pie && info.ring ? p.clone().copy(piePoint(info, value / 2)).project(this.camera()) : p); // a pie's value sits on its arc
      item.label.style.left = `${((at.x + 1) / 2) * rect.width}px`;
      item.label.style.top = `${((1 - at.y) / 2) * rect.height}px`;
      const unit = info.unit === "°" || !info.unit ? info.unit : " " + info.unit;
      const typing = item === this.active?.item && this.active.typed !== null;
      const symbol = info.symbol ?? "";
      const shown = symbol + (typing ? `${typedShown(this.active!.typed ?? "", this.active!.negative)}|` : formatValue(info.along ? item.travel : value * (info.factor || 1)));
      const fields = item === this.active?.item ? this.active.fields : null;
      const grid = info.plane && (item.grid || fields) ? { ...gridStart(this, info), ...item.grid } : null;
      const gridText = grid ? (fields ? `${fields.shown(0, String(grid.columns))} × ${fields.shown(1, String(grid.rows))}` : `${grid.columns} × ${grid.rows}`) : "";
      const snapText = snapped < 0 ? "" : info.snapNames?.[snapped] === "face" ? " - square to a face" : " - square to the global axes";
      item.label.textContent = info.toggle ? info.label : grid ? `${info.label} ${gridText}` : info.pie ? `${shown}°` : info.badge ? `${info.label} ${shown}` : info.arrowhead ? `${shown}${unit}` : `${info.label} ${shown}${unit}${snapText}`;
      item.label.style.outline = typing || fields ? "1px solid #ffb347" : "";
      item.label.style.fontWeight = hot ? "bold" : "normal";
    }
  }

  // ---- Pointer ------------------------------------------------------------------------------------------------

  screen(p: THREE.Vector3): THREE.Vector2 {
    const rect = this.dom.getBoundingClientRect();
    const n = p.clone().project(this.camera());
    return new THREE.Vector2(((n.x + 1) / 2) * rect.width + rect.left, ((1 - n.y) / 2) * rect.height + rect.top);
  }

  tipPoint(item: Item): THREE.Vector3 {
    if (item.info.pie && item.info.ring) return piePoint(item.info, handleValue(item.info, item.travel)); // the grip rides the arc
    if (item.info.badge) return new THREE.Vector3(...item.info.anchor); // a number stays where it is while the wheel or typing changes its value
    return new THREE.Vector3(...item.info.anchor).addScaledVector(new THREE.Vector3(...item.info.direction), item.travel).add(item.shift);
  }

  /** The handle under the pointer: the nearest one whose arm or tip is within the grab range. */
  hit(e: { clientX: number; clientY: number }): Item | null {
    const pointer = new THREE.Vector2(e.clientX, e.clientY);
    let best: Item | null = null;
    let bestD = GRAB_PX;
    for (const item of this.items) {
      if (item.info.badge) continue; // a count shown over its point is not grabbed
      if (item.info.arc && item.axis) {
        const d = arcDistance(this, item, pointer);
        if (d < bestD) {
          bestD = d;
          best = item;
        }
        continue;
      }
      const tip = this.tipPoint(item);
      const dir = new THREE.Vector3(...item.info.direction);
      const move = item.info.kind === "move";
      const ratio = move ? MOVE_ARM_PX / ARM_PX : isPushPullArrow(item.info) ? PUSH_PULL_ARM_RATIO : 1;
      const reach = this.pixelSizeAt(tip) * ARM_PX * ratio;
      const end = item.info.toggle ? this.screen(tip) : this.screen(tip.clone().addScaledVector(dir, reach));
      // a is the tail (a move arrow's start, a pull handle's grab point) and b the head (a move arrow's tip, a pull handle's arm end).
      const a = this.screen(tip);
      const b = end;
      const ab = b.clone().sub(a);
      const only = grabFraction(item.info.kind, item.info.toggle);
      const t = only !== null ? only : projectOnSegment(pointer.x, pointer.y, a.x, a.y, b.x, b.y, 1e-6).t;
      const d = pickScore(pointer.distanceTo(a.clone().addScaledVector(ab, t)), item.info.kind, t);
      if (d < bestD) {
        bestD = d;
        best = item;
      }
      if (isPushPullArrow(item.info)) {
        // The red mirrored arrow (pushpullarrows.ts) is the same handle seen from its other side: grabbing it grabs this one.
        const anchor = new THREE.Vector3(...item.info.anchor);
        const far = mirrorEnd(item.info.anchor, item.info.direction, this.pixelSizeAt(anchor) * ARM_PX * PUSH_PULL_ARM_RATIO);
        const m = segmentPx({ x: pointer.x, y: pointer.y }, this.screen(anchor), this.screen(new THREE.Vector3(...far)));
        if (m < bestD) {
          bestD = m;
          best = item;
        }
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

  ray(e: { clientX: number; clientY: number }): THREE.Ray {
    const rect = this.dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera());
    return this.raycaster.ray;
  }

  down(e: PointerEvent): boolean {
    return handleDown(this, e);
  }

  move(e: PointerEvent) {
    return handleMove(this, e);
  }

  /** Whether a number is being typed for the handle being dragged. */
  get typing(): boolean {
    return this.active?.typed != null;
  }

  key(e: { key: string }): boolean {
    return handleKey(this, e);
  }

  finish() {
    return finishHandle(this);
  }

  cancel() {
    return cancelHandle(this);
  }

  up(e: PointerEvent) {
    return handleUp(this, e);
  }

}

