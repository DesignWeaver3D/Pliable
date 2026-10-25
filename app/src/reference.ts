/** Reference geometry in the 3D view: the principal axes and origin, and the snap targets built from them. */
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { Viewport } from "./viewport";
import { holeAxisPoints } from "./holepoints.ts";
import { mouthPoints, snapCentres } from "./placepick";
import { AXIS_COLORS, axisHalfLength, modelBounds, type Box6 } from "./axes";

const AXES = [
  { name: "X axis", dir: new THREE.Vector3(1, 0, 0), color: AXIS_COLORS.x },
  { name: "Y axis", dir: new THREE.Vector3(0, 1, 0), color: AXIS_COLORS.y },
  { name: "Z axis", dir: new THREE.Vector3(0, 0, 1), color: AXIS_COLORS.z },
];
const SNAP_PX = 12;
type Box3Holder = THREE.Object3D;

export interface ReferenceSnap {
  point: THREE.Vector3;
  /** What was hit, for the status line. */
  label: string;
}

/** Where a face plane (point + normal) meets the axis through the origin along `dir`, or null if parallel. */
export function axisMeetsPlane(dir: THREE.Vector3, planePoint: THREE.Vector3, normal: THREE.Vector3): THREE.Vector3 | null {
  const along = normal.dot(dir);
  if (Math.abs(along) < 1e-9) return null;
  return dir.clone().multiplyScalar(normal.dot(planePoint) / along);
}

/** The point of the line through the origin along `dir` nearest to a ray (closest approach of two lines). */
export function nearestOnAxis(dir: THREE.Vector3, ray: THREE.Ray): THREE.Vector3 | null {
  const w = ray.origin.clone(); // origin of the axis is (0,0,0): w = P0 - Q0 with P0 the axis point
  const b = dir.dot(ray.direction);
  const denom = 1 - b * b;
  if (denom < 1e-9) return null;
  const d = dir.dot(w);
  const e = ray.direction.dot(w);
  return dir.clone().multiplyScalar((b * e - d) / denom);
}

export class ReferenceView {
  private readonly group = new THREE.Group();
  private readonly lines: LineSegments2[] = [];
  private readonly origin = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
  private half = 0;
  private seen: unknown = null;
  private shown = true;

  constructor(private readonly viewport: Viewport) {
    for (const axis of AXES) {
      for (const [positive, depthTest] of [[true, true], [false, true], [true, false], [false, false]] as const) {
        // The depth-tested lines are the solid ones; the others show faintly through the model so the axes never vanish inside a solid.
        const line = new LineSegments2(
          new LineSegmentsGeometry(),
          new LineMaterial({ color: axis.color, linewidth: depthTest ? (positive ? 2 : 1) : 1, transparent: true, opacity: depthTest ? (positive ? 0.9 : 0.35) : positive ? 0.25 : 0.1, depthTest }),
        );
        line.userData = { dir: axis.dir, positive };
        line.renderOrder = 1;
        line.frustumCulled = false;
        this.lines.push(line);
        this.group.add(line);
      }
    }
    this.origin.renderOrder = 4;
    this.group.add(this.origin);
    viewport.scene.add(this.group);
  }

  get visible(): boolean {
    return this.shown;
  }

  setVisible(on: boolean) {
    this.shown = on;
    this.group.visible = on;
  }

  /** Call every frame: follows the model's size and keeps line widths right. */
  tick() {
    this.refreshLength();
    const size = this.viewport.renderer.getSize(new THREE.Vector2());
    for (const l of this.lines) l.material.resolution.set(size.x, size.y);
    const scale = this.viewport.pixelSizeAt(new THREE.Vector3()) * 4;
    this.origin.scale.setScalar(scale);
  }

  /** Axis length follows the whole project: the model's bounds (committed or preview, hidden bodies included, so hiding never shrinks the axes) and sketch geometry. */
  private refreshLength() {
    const data = this.viewport.meshData;
    const extras: Box3Holder[] = [];
    this.viewport.scene.traverse((o) => {
      if (o.userData.extent && o.parent) extras.push(o);
    });
    const boxes: Box6[] = [];
    const box = new THREE.Box3();
    for (const o of extras) {
      box.makeEmpty().setFromObject(o);
      if (!box.isEmpty()) boxes.push([box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z]);
    }
    // The mesh bounds come from the core and cover every body; hiding only filters what is drawn.
    const modelBox = data ? modelBounds(data.bounds, data.edgePositions) : null;
    if (modelBox) boxes.push(modelBox);
    const key = data;
    const half = axisHalfLength(boxes);
    if (key === this.seen && half === this.half) return;
    this.seen = key;
    this.setHalf(half);
  }

  private setHalf(half: number) {
    this.half = half;
    for (const line of this.lines) {
      const d = line.userData.dir as THREE.Vector3;
      const sign = line.userData.positive ? 1 : -1;
      line.geometry.setPositions([0, 0, 0, d.x * sign * half, d.y * sign * half, d.z * sign * half]);
    }
  }

  /** Reference snap nearest the pointer: origin, then a point where an axis meets the face under it, the face centre, or a point along an axis. */
  snapAt(e: PointerEvent, extra: ReferenceSnap[] = []): ReferenceSnap | null {
    const rect = this.viewport.renderer.domElement.getBoundingClientRect();
    const here = new THREE.Vector2(e.clientX - rect.left, e.clientY - rect.top);
    const candidates: ReferenceSnap[] = [{ point: new THREE.Vector3(), label: "Origin" }, ...extra];
    const face = this.viewport.faceUnder(e);
    const range = face ? this.viewport.meshData?.faces.find((f) => f.id === face.id) : undefined;
    if (range?.centroid) {
      const centre = new THREE.Vector3(...range.centroid);
      candidates.push({ point: centre, label: "Face centre" });
      if (range.normal) {
        const normal = new THREE.Vector3(...range.normal);
        for (const axis of AXES) {
          const p = axisMeetsPlane(axis.dir, centre, normal);
          if (p) candidates.push({ point: p, label: `${axis.name} meets face` });
        }
      }
    }
    // Model vertices; hidden ones (well behind the face under the pointer) are skipped.
    const data = this.viewport.meshData;
    const hitDistance = face ? this.viewport.camera.position.distanceTo(face.point) : Infinity;
    const visible = (p: THREE.Vector3) => !face || this.viewport.camera.position.distanceTo(p) <= hitDistance * 1.01 + this.viewport.pixelSizeAt(p) * SNAP_PX;
    // Every hole's axis: its middle and its two end points (the circle centres at both openings).
    for (const c of data?.centres ?? []) {
      for (const [xyz, label] of holeAxisPoints(c)) {
        const p = new THREE.Vector3(...xyz);
        if (label === "Hole centre" || visible(p)) candidates.push({ point: p, label });
      }
    }
    // Hole centres of every hole, not just the hovered one: a pick in progress never hovers, so none would be shown. A
    // centre sits at mid-depth inside its hole, behind the face under the pointer, so the hidden-point test does not apply.
    for (const p of snapCentres(data?.centres ?? [], () => true)) candidates.push({ point: new THREE.Vector3(...p), label: "Hole centre" });
    // The same centres carried along their axes to the faces around each mouth: the hole centre as it appears on the surface.
    const planes = (data?.faces ?? []).filter((f) => f.centroid && f.normal).map((f) => ({ point: f.centroid as [number, number, number], normal: f.normal as [number, number, number] }));
    for (const c of data?.centres ?? []) {
      if (!c.axis) continue;
      for (const p of mouthPoints(c.position as [number, number, number], c.axis as [number, number, number], planes)) {
        const point = new THREE.Vector3(...p);
        if (visible(point)) candidates.push({ point, label: "Hole centre" });
      }
    }
    // The centre of every circular or elliptical edge, so an arc or a slanted hole's mouth has its centre to snap to.
    for (const e of data?.edges ?? []) {
      if (!e.centre) continue;
      const p = new THREE.Vector3(...e.centre);
      if (visible(p)) candidates.push({ point: p, label: "Centre" });
    }
    for (const v of data?.vertices ?? []) {
      const p = new THREE.Vector3(...v.position);
      if (visible(p)) candidates.push({ point: p, label: "Vertex" });
    }
    let best: (ReferenceSnap & { px: number }) | null = null;
    for (const c of candidates) {
      const px = this.viewport.toScreen(c.point).distanceTo(here);
      if (px < SNAP_PX && (!best || px < best.px)) best = { ...c, px };
    }
    if (best) return best;
    // A point on a model edge.
    if (data) {
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      for (const edge of data.edges) {
        for (let i = edge.start; i + 1 < edge.start + edge.count; i += 2) {
          a.fromArray(data.edgePositions, i * 3);
          b.fromArray(data.edgePositions, (i + 1) * 3);
          const pa = this.viewport.toScreen(a);
          const pb = this.viewport.toScreen(b);
          const ab = pb.clone().sub(pa);
          const t = ab.lengthSq() === 0 ? 0 : Math.max(0, Math.min(1, here.clone().sub(pa).dot(ab) / ab.lengthSq()));
          const px = pa.clone().addScaledVector(ab, t).distanceTo(here);
          const point = a.clone().lerp(b, t);
          if (px < SNAP_PX / 2 && visible(point) && (!best || px < best.px)) best = { point, label: "On edge", px };
        }
      }
      if (best) return best;
    }
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((here.x / rect.width) * 2 - 1, -(here.y / rect.height) * 2 + 1), this.viewport.camera);
    for (const axis of AXES) {
      const p = nearestOnAxis(axis.dir, ray.ray);
      if (!p || Math.abs(p.dot(axis.dir)) > this.half) continue;
      const px = this.viewport.toScreen(p).distanceTo(here);
      if (px < SNAP_PX / 2 && (!best || px < best.px)) best = { point: p, label: `On ${axis.name}`, px };
    }
    return best;
  }
}

export interface PickOptions {
  /** More snap points to offer (the corners, edge midpoints, face centres and centre of a shape being previewed). */
  extra?: { point: number[]; label: string }[];
  /** A point already chosen: a line is drawn from it to the snap under the pointer. */
  from?: number[];
}

/** Lets the user click a reference snap in the 3D view; resolves with the point, or null when cancelled. */
export class PointPicker {
  private marker = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]), new THREE.PointsMaterial({ color: 0xffd36b, size: 12, sizeAttenuation: false, depthTest: false }));
  private baseMarker = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]), new THREE.PointsMaterial({ color: 0x5ec8ff, size: 12, sizeAttenuation: false, depthTest: false }));
  private line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x5ec8ff, depthTest: false }));
  private current: ReferenceSnap | null = null;
  private done: ((p: number[] | null) => void) | null = null;

  constructor(
    private readonly viewport: Viewport,
    private readonly reference: ReferenceView,
    private readonly status: (text: string) => void,
  ) {
    for (const o of [this.marker, this.baseMarker, this.line]) {
      o.visible = false;
      o.renderOrder = 6;
      o.frustumCulled = false;
      viewport.scene.add(o);
    }
    window.addEventListener("keydown", (e) => {
      if (this.done && e.key === "Escape") this.finish(null);
    });
  }

  get picking(): boolean {
    return this.done !== null;
  }

  /** Keep a marker at a chosen base point (null removes it). */
  showBase(point: number[] | null) {
    this.baseMarker.visible = !!point;
    if (point) this.baseMarker.position.fromArray(point);
  }

  pick(options: PickOptions = {}): Promise<number[] | null> {
    this.finish(null);
    this.reference.setVisible(true);
    const extra = (options.extra ?? []).map((e) => ({ point: new THREE.Vector3(...e.point), label: e.label }));
    const from = options.from ? new THREE.Vector3(...options.from) : null;
    if (from) this.showBase(options.from!);
    this.status("Pick a point: hover the origin, an axis or a face; click to use it, Escape to cancel");
    return new Promise((resolve) => {
      this.done = resolve;
      this.viewport.interceptor = {
        down: () => {},
        move: (e) => {
          this.current = this.reference.snapAt(e, extra);
          this.marker.visible = !!this.current;
          this.line.visible = !!this.current && !!from;
          if (this.current) {
            this.marker.position.copy(this.current.point);
            if (from) this.line.geometry.setFromPoints([from, this.current.point]);
            this.status(`${this.current.label}: ${this.current.point.toArray().map((x) => parseFloat(x.toFixed(3))).join(", ")}`);
          }
        },
        up: () => this.finish(this.current ? this.current.point.toArray() : null, !this.current),
      };
    });
  }

  private finish(point: number[] | null, keepOpen = false) {
    if (!this.done || keepOpen) return;
    const done = this.done;
    this.done = null;
    this.viewport.interceptor = null;
    this.marker.visible = false;
    this.line.visible = false;
    done(point);
  }
}
