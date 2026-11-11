/** Building the handles a tool declares: the arrow, ring or grip of each, its label, and the arc that turns another handle. */
import type { Item } from "./manipulator.ts";
import * as THREE from "three";
import type { HandleInfo } from "./tools.ts";
import { AXIS_LINE, HANDLE_OUTLINE, handleColors, handleValue, travelFor, ARC_HALF_SPAN, ARC_STEPS, ARC_REST_OPACITY, COLOR_SNAPPED } from "./handlemath.ts";
import { pieLines, pieTangent } from "./piegizmo.ts";
import type { Manipulator } from "./manipulator.ts";

/** The part of the Manipulator this file uses. */
export type HandleBuildContext = Pick<Manipulator, "active" | "layer" | "onDrag" | "root" | "screen">;

export function buildHandle(manip: HandleBuildContext, info: HandleInfo): Item {
  const material = () => new THREE.MeshBasicMaterial({ color: handleColors(info).rest, depthTest: false, transparent: true });
  const group = new THREE.Group();
  group.renderOrder = 10;
  const dir = new THREE.Vector3(...info.direction);
  group.position.set(...info.anchor);
  const resize = info.kind === "resize" && !info.toggle;
  const arrowhead = info.arrowhead && !info.toggle;
  const geometry = info.toggle ? new THREE.SphereGeometry(0.17, 16, 12) : resize && !arrowhead ? new THREE.BoxGeometry(0.3, 0.3, 0.3) : new THREE.ConeGeometry(0.16, 0.42, 16);
  const tip = new THREE.Mesh(geometry, material());
  tip.renderOrder = 11;
  // A dark outline so the grip stays visible against light surfaces: a slightly larger back-facing copy drawn just beneath it.
  const outline = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: HANDLE_OUTLINE, side: THREE.BackSide, depthTest: false, transparent: true, opacity: 0.6 }));
  outline.scale.setScalar(1.2);
  outline.renderOrder = 10;
  tip.add(outline);
  if (arrowhead) {
    tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    tip.position.copy(dir).multiplyScalar(-0.21); // the cone's point sits on the anchor, the end of the dimension line
  } else if (resize) {
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
  manip.root.add(group);
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
    manip.root.add(axis);
  } else if (info.ring && info.axis) {
    // The ring a rotation handle runs on, around the thing it turns: a thin circle in the axis color.
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
    manip.root.add(axis);
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
    manip.root.add(axis);
  }
  const label = document.createElement("div");
  label.style.cssText = "position:absolute;padding:1px 5px;border-radius:3px;background:rgba(20,20,24,.85);color:#ffd9a0;font:11px sans-serif;white-space:nowrap;transform:translate(10px,-50%)";
  manip.layer.append(label);
  if (info.badge) {
    tip.visible = false; // a number over its point: no grip
    arm.visible = false;
  }
  if (arrowhead) {
    arm.visible = false; // the dimension line is drawn from axisFrom; the value sits in the middle of it
    label.style.transform = "translate(-50%,-50%)";
  }
  const made: Item = { info: { ...info }, declared: info.ring && !info.pie ? info : undefined, baseDirection: info.turnedBy ? dir.clone() : undefined, group, tip, arm, axis, label, travel: 0, shift: new THREE.Vector3() };
  if (info.pie || info.badge || arrowhead) editableLabel(manip, made);
  return made;
}

/** The value label of a pie angle or a count badge is always shown and can be edited on the screen: double-click it to type a value (Enter applies, Esc cancels); the wheel over a count changes it by one. */
export function editableLabel(manip: HandleBuildContext, item: Item) {
  item.label.style.pointerEvents = "auto";
  item.label.style.cursor = "text";
  item.label.title = item.info.badge ? "Mouse wheel changes the count; double-click to type it" : item.info.arrowhead ? "Double-click to type the length" : "Double-click to type the angle";
  item.label.addEventListener("dblclick", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (manip.active) return;
    // Typed entry without a drag: the same state a released drag with typed text is in (Enter applies, Escape cancels).
    manip.active = { item, t0: 0, x: e.clientX, y: e.clientY, axisPx: new THREE.Vector2(0, -1), travel0: item.travel, moved: false, typed: "", negative: false, released: true };
  });
  if (item.info.badge) {
    item.label.addEventListener("wheel", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (manip.active) return;
      const now = Math.round(handleValue(item.info, item.travel));
      const next = handleValue(item.info, travelFor(item.info, now + (e.deltaY < 0 ? 1 : -1)));
      if (next === now) return;
      item.travel = travelFor(item.info, next);
      manip.onDrag(item.info.param, next, "end", e.clientX, e.clientY, {});
    }, { passive: false });
  }
}

/** Redraw a pie slice for the angle the handle now holds, and turn the grip's arrow to run along the arc. */
export function drawPie(manip: HandleBuildContext, item: Item) {
  const value = handleValue(item.info, item.travel);
  const lines = pieLines(item.info, value);
  [lines.arc, lines.first, lines.last].forEach((points, i) => (item.axis!.children[i] as THREE.Line).geometry.setFromPoints(points));
  const dir = pieTangent(item.info, value).multiplyScalar(value < 0 ? -1 : 1);
  item.tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  item.arm.geometry.setFromPoints([new THREE.Vector3(), dir]);
}

/** Swing a turn arc round its ring so that it stays centered on the handle: where the tool declared the grip, plus the turn made since. */
export function turnArc(manip: HandleBuildContext, item: Item) {
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
export function reaim(manip: HandleBuildContext, item: Item, arc: Item) {
  const axis = new THREE.Vector3(...arc.info.axis!).normalize();
  const angle = ((handleValue(arc.info, arc.travel) - arc.info.value) * Math.PI) / 180;
  const base = item.baseDirection!;
  const dir = base.clone().applyAxisAngle(axis, angle);
  item.info.direction = [dir.x, dir.y, dir.z];
  item.tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  item.arm.geometry.setFromPoints([new THREE.Vector3(), dir]);
}

/** Pixels from a point to a turn arc on screen. */
export function arcDistance(manip: HandleBuildContext, item: Item, pointer: THREE.Vector2): number {
  const circle = item.axis!.children[0] as THREE.Line;
  circle.updateWorldMatrix(true, false);
  const position = circle.geometry.getAttribute("position");
  const points = Array.from({ length: position.count }, (_, i) => manip.screen(circle.localToWorld(new THREE.Vector3().fromBufferAttribute(position, i))));
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    const segment = new THREE.Line3(new THREE.Vector3(points[i].x, points[i].y, 0), new THREE.Vector3(points[i + 1].x, points[i + 1].y, 0));
    best = Math.min(best, segment.closestPointToPoint(new THREE.Vector3(pointer.x, pointer.y, 0), true, new THREE.Vector3()).distanceTo(new THREE.Vector3(pointer.x, pointer.y, 0)));
  }
  return best;
}
