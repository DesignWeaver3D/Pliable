/** On-screen manipulators (gizmos): the handles a tool declares (docs/protocol.md, Handles), drawn over the model and
 *  dragged with the left button. One handle sets one parameter; the host receives the new value while dragging.
 *  The maths that does not need a camera is exported for tests (`node --test app/tests`). */
import * as THREE from "three";
import type { HandleInfo } from "./tools";
import { gridCounts, gridShift, planePoint } from "./gridgrip.ts";
import { TypedFields, typedCounts } from "./typedentry.ts";
import { ARM_PX, GRAB_PX, PUSH_PULL_ARM_RATIO, isPushPullArrow, MOVE_ARM_PX, AXIS_LINE, HANDLE_OUTLINE, pickScore, grabFraction, handleColors, handleValue, snapValue, linkedValues, travelFor, typedTravel, typedStep, lineParam, formatValue, ARC_RADIUS_PX, EXTENSION_PX, ARC_HALF_SPAN, ARC_STEPS, ARC_REST_OPACITY, COLOR_SNAPPED, snappedIndex, RING_VIEW_FRACTION, refitRing } from "./handlemath.ts";
import { roundValue } from "./precision.ts";
import { pieAngleAt, pieLines, piePoint, pieTangent } from "./piegizmo.ts";
export * from "./handlemath.ts"; // the maths moved to its own file; the tests and other modules still import it from here

interface Item {
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
      this.items.push(this.build(info));
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
    // A dark outline so the grip stays visible against light surfaces: a slightly larger back-facing copy drawn just beneath it.
    const outline = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: HANDLE_OUTLINE, side: THREE.BackSide, depthTest: false, transparent: true, opacity: 0.6 }));
    outline.scale.setScalar(1.2);
    outline.renderOrder = 10;
    tip.add(outline);
    if (resize) {
      tip.position.copy(dir).multiplyScalar(-0.15); // the grip sits on the anchor, with a thin stem back to the model
    } else if (!info.toggle) {
      tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      // Both kinds start at their anchor (the point being moved, on the face) and point away along their axis, so the
      // whole arrow stands outside the surface it moves, like an axis gizmo.
      tip.position.copy(dir).multiplyScalar(0.79);
    }
    // A resize grip's stem runs from the cube back into the model; every other arm points away from its anchor.
    const armEnd = resize ? dir.clone().multiplyScalar(-1) : dir.clone();
    const arm = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), info.toggle ? new THREE.Vector3() : armEnd]),
      new THREE.LineBasicMaterial({ color: handleColors(info).rest, depthTest: false, transparent: true }),
    );
    arm.renderOrder = 10;
    group.add(tip, arm);
    this.root.add(group);
    let axis: THREE.Group | undefined;
    if (info.pie && info.ring && info.axis) {
      // A pie slice: the arc from the source round to the angle, and a short line toward the axis at each end (see piegizmo.ts); redrawn each frame.
      axis = new THREE.Group();
      axis.renderOrder = 9;
      for (let i = 0; i < 3; i++) {
        const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: handleColors(info).rest, depthTest: false, transparent: true, opacity: ARC_REST_OPACITY }));
        line.renderOrder = 9;
        axis.add(line);
      }
      this.root.add(axis);
    } else if (info.ring && info.axis) {
      // The ring a rotation handle runs on, around the thing it turns: a thin circle in the axis colour.
      axis = new THREE.Group();
      axis.renderOrder = 9;
      const [cx, cy, cz, radius] = info.ring;
      const normal = new THREE.Vector3(...info.axis);
      const points = info.arc
        ? Array.from({ length: ARC_STEPS + 1 }, (_, i) => {
            const a = -ARC_HALF_SPAN + (2 * ARC_HALF_SPAN * i) / ARC_STEPS;
            return new THREE.Vector3(Math.cos(a), Math.sin(a), 0).multiplyScalar(radius);
          })
        : Array.from({ length: 65 }, (_, i) => new THREE.Vector3(Math.cos((i / 64) * Math.PI * 2), Math.sin((i / 64) * Math.PI * 2), 0).multiplyScalar(radius));
      const circle = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: handleColors(info).rest, depthTest: false, transparent: true, opacity: info.arc ? ARC_REST_OPACITY : 0.55 }));
      circle.renderOrder = 9;
      circle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      circle.userData.base = circle.quaternion.clone();
      if (info.arc) {
        tip.visible = false; // the arc itself is the handle: no cone and no arm
        arm.visible = false;
      }
      axis.position.set(cx, cy, cz);
      axis.add(circle);
      if (info.arc && info.snaps?.length) {
        const ticks = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: COLOR_SNAPPED, depthTest: false, transparent: true, opacity: 0.9 }));
        ticks.renderOrder = 9;
        ticks.quaternion.copy(circle.userData.base);
        axis.add(ticks);
      }
      this.root.add(axis);
    } else if (info.axisFrom) {
      axis = new THREE.Group();
      axis.renderOrder = 9;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: AXIS_LINE, depthTest: false, transparent: true, opacity: 0.9 }));
      line.renderOrder = 9;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: AXIS_LINE, depthTest: false, transparent: true }));
      dot.renderOrder = 9;
      axis.add(line, dot);
      if (info.extension) {
        const ends = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: AXIS_LINE, depthTest: false, transparent: true, opacity: 0.9 }));
        ends.renderOrder = 9;
        axis.add(ends);
      }
      this.root.add(axis);
    }
    const label = document.createElement("div");
    label.style.cssText = "position:absolute;padding:1px 5px;border-radius:3px;background:rgba(20,20,24,.85);color:#ffd9a0;font:11px sans-serif;white-space:nowrap;transform:translate(10px,-50%)";
    this.layer.append(label);
    if (info.badge) {
      tip.visible = false; // a number over its point: no grip
      arm.visible = false;
    }
    const made: Item = { info: { ...info }, declared: info.ring && !info.pie ? info : undefined, baseDirection: info.turnedBy ? dir.clone() : undefined, group, tip, arm, axis, label, travel: 0, shift: new THREE.Vector3() };
    if (info.pie || info.badge) this.editableLabel(made);
    return made;
  }

  /** The value label of a pie angle or a count badge is always shown and can be edited on the screen: double-click it to type a value (Enter applies, Esc cancels); the wheel over a count changes it by one. */
  private editableLabel(item: Item) {
    item.label.style.pointerEvents = "auto";
    item.label.style.cursor = "text";
    item.label.title = item.info.badge ? "Mouse wheel changes the count; double-click to type it" : "Double-click to type the angle";
    item.label.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.active) return;
      // Typed entry without a drag: the same state a released drag with typed text is in (Enter applies, Escape cancels).
      this.active = { item, t0: 0, x: e.clientX, y: e.clientY, axisPx: new THREE.Vector2(0, -1), travel0: item.travel, moved: false, typed: "", negative: false, released: true };
    });
    if (item.info.badge) {
      item.label.addEventListener("wheel", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.active) return;
        const now = Math.round(handleValue(item.info, item.travel));
        const next = handleValue(item.info, travelFor(item.info, now + (e.deltaY < 0 ? 1 : -1)));
        if (next === now) return;
        item.travel = travelFor(item.info, next);
        this.onDrag(item.info.param, next, "end", e.clientX, e.clientY, {});
      }, { passive: false });
    }
  }

  /** Redraw a pie slice for the angle the handle now holds, and turn the grip's arrow to run along the arc. */
  private drawPie(item: Item) {
    const value = handleValue(item.info, item.travel);
    const lines = pieLines(item.info, value);
    [lines.arc, lines.first, lines.last].forEach((points, i) => (item.axis!.children[i] as THREE.Line).geometry.setFromPoints(points));
    const dir = pieTangent(item.info, value).multiplyScalar(value < 0 ? -1 : 1);
    item.tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    item.arm.geometry.setFromPoints([new THREE.Vector3(), dir]);
  }

  /** Swing a turn arc round its ring so that it stays centred on the handle: where the tool declared the grip, plus the turn made since. */
  private turnArc(item: Item) {
    const declared = item.declared!;
    const circle = item.axis!.children[0] as THREE.Line;
    const base = circle.userData.base as THREE.Quaternion;
    const [cx, cy, cz] = declared.ring!;
    const local = new THREE.Vector3(...declared.anchor).sub(new THREE.Vector3(cx, cy, cz)).applyQuaternion(base.clone().invert());
    const turned = ((handleValue(item.info, item.travel) - declared.value) * Math.PI) / 180;
    const here = Math.atan2(local.y, local.x);
    circle.quaternion.copy(base).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), here + turned));
    // Tick marks at the snap angles that fall under the arc, fixed on the ring while the arc slides past them.
    const ticks = item.axis!.children[1] as THREE.LineSegments | undefined;
    if (ticks) {
      const value = handleValue(item.info, item.travel);
      const zero = here - ((45 + declared.value) * Math.PI) / 180; // the ring angle of the arrows' starting direction
      const points: THREE.Vector3[] = [];
      for (const snap of declared.snaps ?? []) {
        const off = snap + 360 * Math.round((value - snap) / 360) - value;
        if (Math.abs(off) > 60) continue;
        const a = zero + ((45 + snap + 360 * Math.round((value - snap) / 360)) * Math.PI) / 180;
        points.push(new THREE.Vector3(Math.cos(a) * 0.93, Math.sin(a) * 0.93, 0).multiplyScalar(declared.ring![3]), new THREE.Vector3(Math.cos(a) * 1.07, Math.sin(a) * 1.07, 0).multiplyScalar(declared.ring![3]));
      }
      ticks.geometry.setFromPoints(points);
    }
  }

  /** Swing an arrow with the arc that turns it: its built direction turned about the arc's axis by the arc's drag so far. */
  private reaim(item: Item, arc: Item) {
    const axis = new THREE.Vector3(...arc.info.axis!).normalize();
    const angle = ((handleValue(arc.info, arc.travel) - arc.info.value) * Math.PI) / 180;
    const base = item.baseDirection!;
    const dir = base.clone().applyAxisAngle(axis, angle);
    item.info.direction = [dir.x, dir.y, dir.z];
    item.tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    item.arm.geometry.setFromPoints([new THREE.Vector3(), dir]);
  }

  /** Pixels from a point to a turn arc on screen. */
  private arcDistance(item: Item, pointer: THREE.Vector2): number {
    const circle = item.axis!.children[0] as THREE.Line;
    circle.updateWorldMatrix(true, false);
    const position = circle.geometry.getAttribute("position");
    const points = Array.from({ length: position.count }, (_, i) => this.screen(circle.localToWorld(new THREE.Vector3().fromBufferAttribute(position, i))));
    let best = Infinity;
    for (let i = 0; i + 1 < points.length; i++) {
      const segment = new THREE.Line3(new THREE.Vector3(points[i].x, points[i].y, 0), new THREE.Vector3(points[i + 1].x, points[i + 1].y, 0));
      best = Math.min(best, segment.closestPointToPoint(new THREE.Vector3(pointer.x, pointer.y, 0), true, new THREE.Vector3()).distanceTo(new THREE.Vector3(pointer.x, pointer.y, 0)));
    }
    return best;
  }

  /** Per frame: keep handles a constant size on screen and put the value labels beside them. */
  update() {
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
      if (item.declared?.arc && item.axis) this.turnArc(item);
      if (item.baseDirection && this.active?.item.info.arc && this.active.item.info.param === item.info.turnedBy) this.reaim(item, this.active.item);
      const { info, group } = item;
      const pos = this.tipPoint(item);
      group.position.copy(pos);
      if (info.pie && item.axis) this.drawPie(item);
      if (item.axis && info.axisFrom) {
        const from = new THREE.Vector3(...info.axisFrom);
        const line = item.axis.children[0] as THREE.Line;
        line.geometry.setFromPoints([from, pos]);
        item.axis.children[1].position.copy(from);
        item.axis.children[1].scale.setScalar(this.pixelSizeAt(from) * 4);
        if (info.extension) {
          // Short extension lines at both ends of a dimension line, pointing the way `extension` says (in toward the axis), a fixed length on screen.
          const out = new THREE.Vector3(...info.extension).multiplyScalar(this.pixelSizeAt(from) * EXTENSION_PX);
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
      const color = hot ? colors.hot : colors.rest;
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
      item.label.style.display = behind || (!hot && !info.pie && !info.badge) ? "none" : "block"; // only the handle under the pointer or being dragged names itself (a pie angle and a count always show their value)
      const at = info.pie && info.ring ? p.clone().copy(piePoint(info, value / 2)).project(this.camera()) : p; // a pie's value sits on its arc
      item.label.style.left = `${((at.x + 1) / 2) * rect.width}px`;
      item.label.style.top = `${((1 - at.y) / 2) * rect.height}px`;
      const unit = info.unit === "Â°" || !info.unit ? info.unit : " " + info.unit;
      const typing = item === this.active?.item && this.active.typed !== null;
      const symbol = info.symbol ?? "";
      const shown = symbol + (typing ? `${this.active!.negative ? "-" : ""}${this.active!.typed}|` : formatValue(info.along ? item.travel : value * (info.factor || 1)));
      const fields = item === this.active?.item ? this.active.fields : null;
      const grid = info.plane && (item.grid || fields) ? { ...this.gridStart(info), ...item.grid } : null;
      const gridText = grid ? (fields ? `${fields.shown(0, String(grid.columns))} × ${fields.shown(1, String(grid.rows))}` : `${grid.columns} × ${grid.rows}`) : "";
      const snapText = snapped < 0 ? "" : info.snapNames?.[snapped] === "face" ? " - square to a face" : " - square to the global axes";
      item.label.textContent = info.toggle ? info.label : grid ? `${info.label} ${gridText}` : info.pie ? `${shown}°` : info.badge ? `${info.label} ${shown}` : `${info.label} ${shown}${unit}${snapText}`;
      item.label.style.outline = typing || fields ? "1px solid #ffb347" : "";
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
    if (item.info.pie && item.info.ring) return piePoint(item.info, handleValue(item.info, item.travel)); // the grip rides the arc
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
        const d = this.arcDistance(item, pointer);
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
      const t = only !== null ? only : ab.lengthSq() < 1e-6 ? 0 : Math.max(0, Math.min(1, pointer.clone().sub(a).dot(ab) / ab.lengthSq()));
      const d = pickScore(pointer.distanceTo(a.clone().addScaledVector(ab, t)), item.info.kind, t);
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
    if (item.info.plane) {
      const [u, v] = item.info.plane;
      const p = planePoint(ray.origin.toArray(), ray.direction.toArray(), item.info.anchor, u, v);
      this.active.p0 = p ? new THREE.Vector3(...p) : undefined;
    }
    this.dom.style.cursor = "grabbing";
    (document.activeElement as HTMLElement | null)?.blur?.(); // typed digits belong to the handle, not to a form field that had focus
    return true;
  }

  /** The travel (model units from the declared anchor) the pointer asks for. */
  private travelAt(a: Active, e: { clientX: number; clientY: number }): number {
    const { info } = a.item;
    const ray = this.ray(e);
    if (info.pie) {
      const degrees = pieAngleAt(info, ray.origin, ray.direction, handleValue(info, a.item.travel));
      if (degrees !== null) return travelFor(info, degrees);
    }
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
    if (a.item.info.plane) {
      this.moveGrid(a, e);
      return;
    }
    a.moved = true;
    const value = snapValue(handleValue(a.item.info, this.travelAt(a, e)), a.item.info.snaps);
    a.item.travel = travelFor(a.item.info, value);
    this.onDrag(a.item.info.param, roundValue(value), "move", e.clientX, e.clientY, linkedValues(a.item.info, a.item.travel));
  }

  /** The counts of a grid grip (its parameter and its first linked one) as the grip was computed. */
  private gridStart(info: HandleInfo): { columns: number; rows: number } {
    return { columns: info.value, rows: info.links?.[0]?.value ?? 1 };
  }

  /** A grid grip follows the pointer in the plane of the steps and asks for whole columns and rows, independently. */
  private moveGrid(a: Active, e: { clientX: number; clientY: number }) {
    const { item } = a;
    const { info } = item;
    if (!info.plane || !a.p0) return;
    const ray = this.ray(e);
    const p = planePoint(ray.origin.toArray(), ray.direction.toArray(), info.anchor, info.plane[0], info.plane[1]);
    if (!p) return;
    const [u, v] = info.plane;
    const start = this.gridStart(info);
    const delta = new THREE.Vector3(...p).sub(a.p0);
    const now = gridCounts(delta.toArray(), u, v, start.columns, start.rows, info.min ?? 1);
    a.moved = true;
    item.grid = now;
    item.shift.set(...gridShift(u, v, now.columns, now.rows, start.columns, start.rows));
    const rowsParam = info.links?.[0]?.param;
    this.onDrag(info.param, now.columns, "move", e.clientX, e.clientY, rowsParam ? { [rowsParam]: now.rows } : {});
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
    if (a.item.info.plane) return this.gridKey(a, e);
    if (e.key === "Enter") {
      // The typed value is applied only now; while typing, only the label shows it and the shape stays put.
      const travel = a.typed === null ? null : typedTravel(a.item.info, a.typed, a.negative);
      if (travel !== null) {
        a.moved = true;
        this.setTravel(a, travel);
      }
      this.finish();
      return true;
    }
    if (e.key === "Escape") {
      if (a.typed !== null && !a.released) {
        a.typed = null; // button still held: back to dragging
        a.negative = false;
        return true;
      }
      this.cancel();
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

  /** Typed entry for a grid grip: digits set the columns, Tab moves to the rows, Enter commits (whole numbers, at least 1), Escape goes back to the mouse, then cancels. */
  private gridKey(a: Active, e: { key: string }): boolean {
    const item = a.item;
    if (e.key === "Enter") {
      if (a.fields) {
        item.grid = typedCounts(a.fields, item.grid ?? this.gridStart(item.info));
        this.applyGrid(item);
        a.moved = true;
      }
      this.finish();
      return true;
    }
    if (e.key === "Escape") {
      if (a.fields && !a.released) {
        a.fields = null; // button still held: back to dragging
        a.typed = null;
        return true;
      }
      this.cancel();
      return true;
    }
    const fields = a.fields ?? new TypedFields(2, true);
    if (!fields.key(e.key)) return false;
    a.fields = fields;
    a.typed = ""; // the mouse is ignored while the numbers are typed (see move)
    return true;
  }

  /** Put a grid grip where its counts say, and tell the form. */
  private applyGrid(item: Item) {
    const info = item.info;
    const now = item.grid;
    if (!info.plane || !now) return;
    const start = this.gridStart(info);
    item.shift.set(...gridShift(info.plane[0], info.plane[1], now.columns, now.rows, start.columns, start.rows));
    const rowsParam = info.links?.[0]?.param;
    this.onDrag(info.param, now.columns, "move", this.active?.lastX ?? 0, this.active?.lastY ?? 0, rowsParam ? { [rowsParam]: now.rows } : {});
  }

  private setTravel(a: Active, travel: number) {
    a.item.travel = travel;
    const { info } = a.item;
    this.onDrag(info.param, roundValue(handleValue(info, travel)), "move", a.lastX ?? a.x, a.lastY ?? a.y, linkedValues(info, travel));
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
    if (info.plane) {
      a.item.shift.set(0, 0, 0);
      a.item.grid = undefined;
      const start = this.gridStart(info);
      const rowsParam = info.links?.[0]?.param;
      if (a.moved) this.onDrag(info.param, start.columns, "cancel", a.lastX ?? a.x, a.lastY ?? a.y, rowsParam ? { [rowsParam]: start.rows } : {});
      return;
    }
    if (a.moved) this.onDrag(info.param, roundValue(handleValue(info, a.travel0)), "cancel", a.lastX ?? a.x, a.lastY ?? a.y, linkedValues(info, a.travel0));
  }

  up(e: PointerEvent) {
    const a = this.active;
    if (!a) return;
    if (a.typed !== null) {
      a.released = true; // typing overrides the drag: the button may be let go, Enter commits and Escape cancels
      return;
    }
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
    if (info.plane) {
      const now = a.item.grid;
      const rowsParam = info.links?.[0]?.param;
      if (a.moved && now) this.onDrag(info.param, now.columns, "end", e.clientX, e.clientY, rowsParam ? { [rowsParam]: now.rows } : {});
      return;
    }
    if (a.moved) this.onDrag(info.param, roundValue(handleValue(info, travel)), "end", e.clientX, e.clientY, linkedValues(info, travel));
  }
}

