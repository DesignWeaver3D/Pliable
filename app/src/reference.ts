/** Reference geometry in the 3D view: the principal axes and origin, and the snap targets built from them. */
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { MeshData } from "./client";
import type { Viewport } from "./viewport";

const AXES = [
  { name: "X axis", dir: new THREE.Vector3(1, 0, 0), color: 0xe5484d },
  { name: "Y axis", dir: new THREE.Vector3(0, 1, 0), color: 0x46a758 },
  { name: "Z axis", dir: new THREE.Vector3(0, 0, 1), color: 0x3e8bff },
];
const SNAP_PX = 12;
const MIN_HALF_LENGTH = 25;

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
  private bounds: number[] | null = null;
  private shown = true;

  constructor(private readonly viewport: Viewport) {
    for (const axis of AXES) {
      for (const positive of [true, false]) {
        const line = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: axis.color, linewidth: positive ? 2 : 1, transparent: true, opacity: positive ? 0.9 : 0.35, depthTest: true }));
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
    const data = this.viewport.meshData;
    if (data && data.bounds !== this.bounds) this.rebuild(data);
    const size = this.viewport.renderer.getSize(new THREE.Vector2());
    for (const l of this.lines) l.material.resolution.set(size.x, size.y);
    const scale = this.viewport.pixelSizeAt(new THREE.Vector3()) * 4;
    this.origin.scale.setScalar(scale);
  }

  private rebuild(data: MeshData) {
    this.bounds = data.bounds;
    const [x0, y0, z0, x1, y1, z1] = data.bounds;
    this.half = Math.max(MIN_HALF_LENGTH, 1.25 * Math.max(Math.abs(x0), Math.abs(y0), Math.abs(z0), Math.abs(x1), Math.abs(y1), Math.abs(z1)));
    for (const line of this.lines) {
      const d = line.userData.dir as THREE.Vector3;
      const sign = line.userData.positive ? 1 : -1;
      line.geometry.setPositions([0, 0, 0, d.x * sign * this.half, d.y * sign * this.half, d.z * sign * this.half]);
    }
  }

  /** Reference snap nearest the pointer: origin, then a point where an axis meets the face under it, the face centre, or a point along an axis. */
  snapAt(e: PointerEvent): ReferenceSnap | null {
    const rect = this.viewport.renderer.domElement.getBoundingClientRect();
    const here = new THREE.Vector2(e.clientX - rect.left, e.clientY - rect.top);
    const candidates: ReferenceSnap[] = [{ point: new THREE.Vector3(), label: "Origin" }];
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

/** Lets the user click a reference snap in the 3D view; resolves with the point, or null when cancelled. */
export class PointPicker {
  private marker = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]), new THREE.PointsMaterial({ color: 0xffd36b, size: 12, sizeAttenuation: false, depthTest: false }));
  private current: ReferenceSnap | null = null;
  private done: ((p: number[] | null) => void) | null = null;

  constructor(
    private readonly viewport: Viewport,
    private readonly reference: ReferenceView,
    private readonly status: (text: string) => void,
  ) {
    this.marker.visible = false;
    this.marker.renderOrder = 6;
    viewport.scene.add(this.marker);
    window.addEventListener("keydown", (e) => {
      if (this.done && e.key === "Escape") this.finish(null);
    });
  }

  get picking(): boolean {
    return this.done !== null;
  }

  pick(): Promise<number[] | null> {
    this.finish(null);
    this.reference.setVisible(true);
    this.status("Pick a point: hover the origin, an axis or a face; click to use it, Escape to cancel");
    return new Promise((resolve) => {
      this.done = resolve;
      this.viewport.interceptor = {
        down: () => {},
        move: (e) => {
          this.current = this.reference.snapAt(e);
          this.marker.visible = !!this.current;
          if (this.current) {
            this.marker.position.copy(this.current.point);
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
    done(point);
  }
}
