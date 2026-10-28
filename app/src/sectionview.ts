/** The section view: the model is cut away on one side of a plane in the view only (the geometry kernel is not asked),
 *  each body's cut face is drawn in its colour with grey hatch lines (a different angle and spacing per body), and where the
 *  cut faces of two bodies overlap the overlap is painted red, which shows that the bodies intersect. */
import * as THREE from "three";
import { bodyColor } from "./bodycolors";
import type { HandleInfo } from "./tools";
import type { Viewport } from "./viewport";
import { frameOf, gridFor, hatchLines, hatchStyle, overlapOf, regionsOf, sliceBodies } from "./sectionmath.ts";
import type { Loop, SectionPlane, V3 } from "./sectionmath.ts";

const HANDLE_PARAM = "section_offset";
const HATCH_COLOUR = 0x59606b;
const OVERLAP_RGBA = [255, 40, 40, 200];
/** Cells along the longer side of the overlap grid. */
const OVERLAP_RESOLUTION = 768;
/** The hatch lines of a body are about this many apart across the model's diagonal (times the body's spacing factor). */
const HATCH_PER_DIAGONAL = 45;
/** The hatch lines are at least this many across a body's thinnest cut, and never closer than the model's diagonal over HATCH_FLOOR. */
const HATCH_PER_THIN = 8;
const HATCH_FLOOR = 1500;

export interface SectionReport {
  /** Bodies the plane cuts. */
  bodies: number;
  /** Area (model units squared) where the cut faces of two bodies overlap, and the pairs of body ids that do. */
  overlapArea: number;
  pairs: [number, number][];
}

export class SectionView {
  active = false;
  /** Called when the plane, the side or the report changed (the card redraws). */
  onChange: () => void = () => {};
  report: SectionReport | null = null;

  private base: SectionPlane = { origin: [0, 0, 0], normal: [0, 0, 1] };
  private offset = 0;
  private flipped = false;
  private dragBase: number | null = null;
  private placed = false;
  private pending = 0;
  private readonly group = new THREE.Group();

  constructor(
    private readonly viewport: Viewport,
    /** Whether the slide gizmo may be shown now (no form or sketch is using the gizmo layer). */
    private readonly gizmoFree: () => boolean,
  ) {
    this.group.renderOrder = 2;
    viewport.scene.add(this.group);
    viewport.onMeshSet = () => {
      if (this.active) this.schedule();
    };
  }

  /** The cutting plane now. */
  get plane(): SectionPlane {
    const n = this.base.normal;
    return { origin: [this.base.origin[0] + n[0] * this.offset, this.base.origin[1] + n[1] * this.offset, this.base.origin[2] + n[2] * this.offset], normal: n };
  }

  get distance(): number {
    return this.offset;
  }

  get isFlipped(): boolean {
    return this.flipped;
  }

  /** How far the plane may slide from where it was chosen: across the model (and always including where it is now). */
  range(): [number, number] {
    const b = this.viewport.meshData?.bounds;
    const n = this.base.normal;
    const o = this.base.origin[0] * n[0] + this.base.origin[1] * n[1] + this.base.origin[2] * n[2];
    let lo = this.offset;
    let hi = this.offset;
    if (b && b.length === 6 && !b.every((c) => c === 0)) {
      lo = Infinity;
      hi = -Infinity;
      for (const x of [b[0], b[3]]) for (const y of [b[1], b[4]]) for (const z of [b[2], b[5]]) {
        const d = x * n[0] + y * n[1] + z * n[2] - o;
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
      }
      lo = Math.min(lo, this.offset);
      hi = Math.max(hi, this.offset);
    }
    return [lo, hi];
  }

  open() {
    if (this.active) return;
    this.active = true;
    if (!this.placed) {
      // The first time: the XY plane through the middle of the model.
      const b = this.viewport.meshData?.bounds;
      const middle = b && b.length === 6 && !b.every((c) => c === 0) ? (b[2] + b[5]) / 2 : 0;
      this.base = { origin: [0, 0, 0], normal: [0, 0, 1] };
      this.offset = middle;
      this.placed = true;
    }
    this.apply();
    this.onChange();
  }

  close() {
    if (!this.active) return;
    this.active = false;
    this.viewport.setSectionClip(null);
    this.clearDrawing();
    if (this.viewport.manipulator.has(HANDLE_PARAM)) this.viewport.manipulator.clear();
    this.report = null;
    this.onChange();
  }

  /** Use another plane (its origin and normal); the cut starts at that plane. */
  setPlane(origin: number[], normal: number[]) {
    const length = Math.hypot(normal[0], normal[1], normal[2]);
    if (!(length > 1e-9)) return;
    this.base = { origin: [origin[0], origin[1], origin[2]], normal: [normal[0] / length, normal[1] / length, normal[2] / length] };
    this.offset = 0;
    this.apply();
  }

  setOffset(value: number) {
    if (!Number.isFinite(value)) return;
    this.offset = value;
    this.apply();
  }

  flip() {
    this.flipped = !this.flipped;
    this.apply();
  }

  /** Re-assert the slide gizmo when nothing else is using the gizmo layer (called every frame). */
  tick() {
    if (!this.active) return;
    const manipulator = this.viewport.manipulator;
    const free = this.gizmoFree();
    if (free && manipulator.count === 0) this.showHandles();
    else if (!free && manipulator.has(HANDLE_PARAM)) manipulator.clear();
  }

  /** A gizmo handle was dragged; true when it is ours. */
  onDrag(param: string, value: number, phase: "move" | "end" | "cancel"): boolean {
    if (param !== HANDLE_PARAM) return false;
    this.dragBase ??= this.offset;
    this.offset = phase === "cancel" ? this.dragBase : this.dragBase + value;
    if (phase !== "move") this.dragBase = null;
    this.apply();
    return true;
  }

  private apply() {
    const n = this.base.normal;
    const o = this.plane.origin;
    const keep = this.flipped ? n : ([-n[0], -n[1], -n[2]] as V3);
    this.viewport.setSectionClip(new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...keep), new THREE.Vector3(...o)));
    if (this.viewport.manipulator.has(HANDLE_PARAM)) this.showHandles();
    this.schedule();
    this.onChange();
  }

  /** An arrow along the plane's normal, at the middle of the model's footprint on the plane. */
  private showHandles() {
    const plane = this.plane;
    const b = this.viewport.meshData?.bounds;
    const centre: V3 = b && b.length === 6 && !b.every((c) => c === 0) ? [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2] : plane.origin;
    const n = plane.normal;
    const along = (centre[0] - plane.origin[0]) * n[0] + (centre[1] - plane.origin[1]) * n[1] + (centre[2] - plane.origin[2]) * n[2];
    const anchor: V3 = [centre[0] - n[0] * along, centre[1] - n[1] * along, centre[2] - n[2] * along];
    const handle: HandleInfo = { param: HANDLE_PARAM, label: "Slide section plane", anchor, direction: [...n], scale: 1, min: null, max: null, toggle: false, kind: "move", unit: "mm", value: 0 };
    this.viewport.manipulator.setHandles([handle]);
  }

  private schedule() {
    if (this.pending) return;
    this.pending = requestAnimationFrame(() => {
      this.pending = 0;
      if (this.active) this.rebuild();
    });
  }

  private clearDrawing() {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      const m = child as THREE.Mesh;
      m.geometry?.dispose();
      const material = m.material as (THREE.Material & { map?: THREE.Texture | null }) | undefined;
      material?.map?.dispose();
      material?.dispose();
    }
  }

  private rebuild() {
    this.clearDrawing();
    const data = this.viewport.meshData;
    if (!data) {
      this.report = null;
      this.onChange();
      return;
    }
    const b = data.bounds;
    const diagonal = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) || 1;
    const frame = frameOf(this.plane);
    const cut = sliceBodies(data.positions, data.indices, data.faces, frame, diagonal * 2e-6);
    const ids = [...new Set(data.faces.map((f) => f.body ?? -1))].sort((x, y) => x - y);
    // Everything is drawn exactly on the plane; the cut face and the red overlay are pushed apart in depth with polygon offsets.
    const at = (x: number, y: number): V3 => [
      frame.origin[0] + frame.u[0] * x + frame.v[0] * y,
      frame.origin[1] + frame.u[1] * x + frame.v[1] * y,
      frame.origin[2] + frame.u[2] * x + frame.v[2] * y,
    ];

    const capPositions: number[] = [];
    const capColours: number[] = [];
    const hatchPositions: number[] = [];
    for (const [body, loops] of cut) {
      const colour = new THREE.Color(body >= 0 ? bodyColor(body) : "#9db4cc");
      for (const region of regionsOf(loops)) {
        const ring = (loop: Loop) => Array.from({ length: loop.length / 2 }, (_, i) => new THREE.Vector2(loop[2 * i], loop[2 * i + 1]));
        const outer = ring(region.outer);
        const holes = region.holes.map(ring);
        const points = outer.concat(...holes);
        const triangles = THREE.ShapeUtils.triangulateShape(outer, holes);
        for (const tri of triangles) {
          for (const index of tri) {
            capPositions.push(...at(points[index].x, points[index].y));
            capColours.push(colour.r, colour.g, colour.b);
          }
        }
      }
      const style = hatchStyle(ids.indexOf(body));
      const lines = hatchLines(loops, style.angle, hatchBase(loops, diagonal) * style.spacing);
      for (let i = 0; i < lines.length; i += 2) hatchPositions.push(...at(lines[i], lines[i + 1]));
    }
    if (capPositions.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(capPositions, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(capColours, 3));
      const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
      this.group.add(new THREE.Mesh(geometry, material));
    }
    if (hatchPositions.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(hatchPositions, 3));
      this.group.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: HATCH_COLOUR })));
    }

    let overlapArea = 0;
    const pairs: [number, number][] = [];
    const grid = cut.size > 1 ? gridFor([...cut.values()].flat(), OVERLAP_RESOLUTION) : null;
    if (grid) {
      const overlap = overlapOf(cut, grid);
      overlapArea = overlap.cells * grid.cell * grid.cell;
      for (const key of overlap.pairs.keys()) pairs.push(key.split(",").map(Number) as [number, number]);
      if (overlap.cells) {
        const pixels = new Uint8Array(grid.w * grid.h * 4);
        overlap.mask.forEach((on, i) => {
          if (on) pixels.set(OVERLAP_RGBA, i * 4);
        });
        const texture = new THREE.DataTexture(pixels, grid.w, grid.h, THREE.RGBAFormat);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.needsUpdate = true;
        const x1 = grid.x0 + grid.w * grid.cell;
        const y1 = grid.y0 + grid.h * grid.cell;
        const corners = [at(grid.x0, grid.y0), at(x1, grid.y0), at(x1, y1), at(grid.x0, y1)];
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(corners.flat(), 3));
        geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
        geometry.setIndex([0, 1, 2, 0, 2, 3]);
        const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
        this.group.add(new THREE.Mesh(geometry, material));
      }
    }
    this.report = { bodies: cut.size, overlapArea, pairs };
    this.onChange();
  }
}

/** The distance between hatch lines before the body's own factor: a fraction of the model's size, but never more than an eighth of the body's thinnest cut, so small and thin parts still get several lines. */
function hatchBase(loops: readonly Loop[], diagonal: number): number {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i += 2) {
      x0 = Math.min(x0, loop[i]);
      x1 = Math.max(x1, loop[i]);
      y0 = Math.min(y0, loop[i + 1]);
      y1 = Math.max(y1, loop[i + 1]);
    }
  }
  const thinnest = Math.min(x1 - x0, y1 - y0);
  return Math.max(Math.min(diagonal / HATCH_PER_DIAGONAL, thinnest / HATCH_PER_THIN), diagonal / HATCH_FLOOR);
}
