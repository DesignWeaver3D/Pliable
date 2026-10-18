/**
 * Sketch mode: draw on a plane in the 3D view (no separate workbench), constrain with the solver in the core,
 * then extrude the profile. All sketch rules live in sketchmodel.ts; this file is the interaction and drawing.
 */
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { CoreClient, MeshData } from "./client";
import type { DimensionOverlay } from "./dimensions";
import * as M from "./sketchmodel";
import type { Viewport } from "./viewport";

const SNAP_PX = 10; // pointer snaps to an existing sketch point this close
const PICK_PX = 8; // pick radius for points and curves in the select tool
const AUTO_AXIS_DEG = 3; // a line drawn within this angle of horizontal/vertical becomes exactly so
const DRAG_START_PX = 3;
const POINT_SIZE_PX = 8;
const PREVIEW_DELAY_MS = 150;
const COLORS = { line: 0x7fd1ff, selected: 0xff8a1f, hover: 0xffffff, pending: 0xffe066, construction: 0x7f8794, grid: 0x3a4150 };

type Tool = "select" | "line" | "rectangle" | "rectcentre" | "circle" | "arc" | "trim" | "extend" | "triangle" | "pentagon" | "hexagon" | "octagon";
/** Regular polygon tools: the centre then a corner; the number of sides is the only difference between them. */
const POLYGON_SIDES: Partial<Record<Tool, number>> = { triangle: 3, pentagon: 5, hexagon: 6, octagon: 8 };
const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: "select", label: "Select", hint: "Click to select, drag points, Delete removes" },
  { id: "line", label: "Line", hint: "Click points; Enter or right-click ends the chain" },
  { id: "rectangle", label: "Rectangle", hint: "Click two opposite corners" },
  { id: "rectcentre", label: "Centre rectangle", hint: "Click the centre, then a corner" },
  { id: "circle", label: "Circle", hint: "Click the centre, then a point on the circle" },
  { id: "arc", label: "Arc", hint: "Click the centre, the start, then the end (counterclockwise)" },
  { id: "trim", label: "Trim", hint: "Click the part of a line to remove, up to the nearest crossing curves" },
  { id: "extend", label: "Extend", hint: "Click near the end of a line to stretch it to the next curve" },
  ...(Object.keys(POLYGON_SIDES) as Tool[]).map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), hint: "Click the centre, then a corner" })),
];

export interface SketchHost {
  status(text: string, error?: boolean): void;
  showPreview(mesh: MeshData): void;
  restore(): void;
  committed(mesh: MeshData): void;
}

interface Snap {
  id?: number;
  u: number;
  v: number;
  axis?: "h" | "v";
}
interface SolveReply {
  status: "ok" | "failed";
  dof: number | null;
  failed: (number | null)[];
  points: { id: number; u: number; v: number }[];
  radii: Record<string, number>;
}

export class SketchMode {
  active = false;
  private s!: M.SketchData;
  private plane = new THREE.Plane();
  private tool: Tool = "select";
  private selection: M.SketchSel[] = [];
  private hover: M.SketchSel | null = null;
  private chain: Snap[] = []; // points clicked so far for the current drawing
  private cursor: Snap | null = null;
  private drag: { id: number; startX: number; startY: number; moved: boolean } | null = null;
  private dof: number | null = null;
  private failed = new Set<number>();
  private undoStack: string[] = [];
  private group = new THREE.Group();
  private normal = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: COLORS.line, linewidth: 2, depthTest: false }));
  private construction = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: COLORS.construction, linewidth: 2, depthTest: false }));
  private marked = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: COLORS.selected, linewidth: 3, depthTest: false }));
  private pending = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: COLORS.pending, linewidth: 2, depthTest: false }));
  private points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: POINT_SIZE_PX, sizeAttenuation: false, vertexColors: true, depthTest: false }));
  private grid: THREE.GridHelper | null = null;
  private solving = false;
  private queued: { drag?: { point: number; u: number; v: number } } | null = null;
  private previewTimer = 0;
  private panel: HTMLElement;
  private extrude = { distance: 10, mode: "join" as "join" | "cut", symmetric: false, revolve: false, angle: 360, open: false };

  constructor(
    private readonly viewport: Viewport,
    private readonly core: CoreClient,
    private readonly overlay: DimensionOverlay,
    private readonly host: SketchHost,
    panel: HTMLElement,
  ) {
    this.panel = panel;
    for (const o of [this.normal, this.construction, this.marked, this.pending, this.points]) {
      o.renderOrder = 5;
      o.frustumCulled = false;
      this.group.add(o);
    }
    window.addEventListener("keydown", (e) => this.onKey(e));
    viewport.renderer.domElement.addEventListener("contextmenu", () => {
      if (this.active && this.chain.length) this.endChain();
    });
  }

  // Entering and leaving ----------------------------------------------------------------------------

  start(plane: M.PlaneData, reference?: { points: M.SketchPoint[]; entities: M.SketchEntity[] }) {
    if (this.active) this.exit();
    // Reference geometry (the face outline) is fixed construction geometry that sketch points can snap to.
    this.s = { plane, points: reference?.points ?? [], entities: reference?.entities ?? [], constraints: [] };
    const f = M.frame(plane);
    this.plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(...f.n), new THREE.Vector3(...f.origin));
    this.tool = "select";
    this.selection = [];
    this.chain = [];
    this.dof = null;
    this.failed.clear();
    this.undoStack = [];
    this.extrude = { distance: 10, mode: "join", symmetric: false, revolve: false, angle: 360, open: false };
    this.active = true;
    this.viewport.selectItems([]); // the model's selection highlight would cover the sketch
    this.buildGrid(f);
    this.viewport.scene.add(this.group);
    this.viewport.interceptor = { down: (e) => this.onDown(e), move: (e) => this.onMove(e), up: (e) => this.onUp(e) };
    this.viewport.lookFrom(new THREE.Vector3(...f.n));
    this.viewport.onFrame2 = () => this.onFrame();
    this.render();
    this.host.status("Sketch: choose a drawing tool (Line, Rectangle, Circle, Arc)");
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    clearTimeout(this.previewTimer);
    this.viewport.interceptor = null;
    this.viewport.onFrame2 = null;
    this.viewport.scene.remove(this.group);
    if (this.grid) {
      this.group.remove(this.grid);
      this.grid.geometry.dispose();
      this.grid = null;
    }
    this.overlay.set([]);
    this.panel.hidden = true;
    this.panel.replaceChildren();
    this.host.restore();
    this.host.status("Sketch closed");
  }

  /** Leave the sketch keeping its closed regions as faces of the model; with no closed outline just leave. */
  async finish() {
    if (!this.active) return;
    clearTimeout(this.previewTimer);
    try {
      const mesh = await this.core.request<MeshData>("sketch_regions", { sketch: this.s });
      this.exit();
      this.host.committed(mesh);
      this.host.status("Sketch closed: its regions are faces now");
    } catch (e) {
      this.exit();
      this.host.status((e as Error).message);
    }
  }

  private buildGrid(f: ReturnType<typeof M.frame>) {
    if (this.grid) this.group.remove(this.grid);
    const size = 200;
    const grid = new THREE.GridHelper(size, 20, COLORS.grid, COLORS.grid);
    (grid.material as THREE.Material).depthTest = false;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(...f.x), new THREE.Vector3(...f.n), new THREE.Vector3(...f.y));
    grid.applyMatrix4(basis);
    grid.position.set(...f.origin);
    grid.renderOrder = 1;
    this.grid = grid;
    this.group.add(grid);
  }

  // Pointer handling --------------------------------------------------------------------------------

  private planeUV(e: PointerEvent): [number, number] | null {
    const p = this.viewport.planePoint(e, this.plane);
    return p ? M.toPlane(this.s.plane, [p.x, p.y, p.z]) : null;
  }

  private screenOf(u: number, v: number): THREE.Vector2 {
    return this.viewport.toScreen(new THREE.Vector3(...M.toWorld(this.s.plane, u, v)));
  }

  private mousePx(e: PointerEvent): THREE.Vector2 {
    const r = this.viewport.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(e.clientX - r.left, e.clientY - r.top);
  }

  private nearestPoint(e: PointerEvent): M.SketchPoint | null {
    const m = this.mousePx(e);
    let best: M.SketchPoint | null = null;
    let bestD = SNAP_PX;
    for (const p of this.s.points) {
      const d = this.screenOf(p.u, p.v).distanceTo(m);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  private snap(e: PointerEvent): Snap | null {
    const near = this.nearestPoint(e);
    if (near) return { id: near.id, u: near.u, v: near.v };
    const uv = this.planeUV(e);
    if (!uv) return null;
    let [u, v] = uv;
    let axis: Snap["axis"];
    const last = this.chain[this.chain.length - 1];
    if (this.tool === "line" && last) {
      const angle = (Math.atan2(v - last.v, u - last.u) * 180) / Math.PI;
      const fromH = Math.min(Math.abs(angle), Math.abs(Math.abs(angle) - 180));
      if (fromH < AUTO_AXIS_DEG) [v, axis] = [last.v, "h"];
      else if (Math.abs(Math.abs(angle) - 90) < AUTO_AXIS_DEG) [u, axis] = [last.u, "v"];
    }
    return { u, v, axis };
  }

  private pick(e: PointerEvent): M.SketchSel | null {
    const point = this.nearestPoint(e);
    if (point) return { kind: "point", id: point.id };
    const uv = this.planeUV(e);
    if (!uv) return null;
    const pixel = this.viewport.pixelSizeAt(new THREE.Vector3(...M.toWorld(this.s.plane, uv[0], uv[1])));
    let best: M.SketchSel | null = null;
    let bestD = PICK_PX * pixel;
    for (const en of this.s.entities) {
      const d = M.distanceTo(this.s, en, uv[0], uv[1]);
      if (d < bestD) {
        best = { kind: "entity", id: en.id };
        bestD = d;
      }
    }
    return best;
  }

  private onMove(e: PointerEvent) {
    if (this.drag) {
      const dx = e.clientX - this.drag.startX;
      const dy = e.clientY - this.drag.startY;
      if (!this.drag.moved && Math.hypot(dx, dy) < DRAG_START_PX) return;
      if (!this.drag.moved) this.pushUndo();
      this.drag.moved = true;
      const uv = this.planeUV(e);
      if (uv) this.resolve({ point: this.drag.id, u: uv[0], v: uv[1] });
      return;
    }
    if (this.tool === "select" || this.tool === "trim" || this.tool === "extend") this.hover = this.pick(e);
    else this.cursor = this.snap(e);
    this.render();
  }

  private onDown(e: PointerEvent) {
    if (this.tool !== "select") return;
    const hit = this.pick(e);
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    if (!hit) {
      if (!additive) this.selection = [];
    } else if (additive) {
      const same = (s: M.SketchSel) => s.kind === hit.kind && s.id === hit.id;
      this.selection = this.selection.some(same) ? this.selection.filter((s) => !same(s)) : [...this.selection, hit];
    } else {
      this.selection = [hit];
    }
    const fixed = hit?.kind === "point" && this.s.points.find((p) => p.id === hit.id)?.fixed;
    if (hit?.kind === "point" && !additive && !fixed) {
      this.drag = { id: hit.id, startX: e.clientX, startY: e.clientY, moved: false };
      this.viewport.renderer.domElement.setPointerCapture(e.pointerId);
    }
    this.render();
  }

  private async onUp(e: PointerEvent) {
    if (this.drag) {
      const moved = this.drag.moved;
      this.drag = null;
      if (moved) await this.resolve(); // settle without pinning the dragged point
      this.render();
      return;
    }
    if (this.tool === "select") return;
    if (this.tool === "trim" || this.tool === "extend") {
      const hit = this.pick(e);
      const uv = this.planeUV(e);
      const line = hit?.kind === "entity" ? this.s.entities.find((x) => x.id === hit.id) : undefined;
      if (line?.type === "line" && uv && !line.reference) {
        this.pushUndo();
        this.s = (this.tool === "trim" ? M.trimLine : M.extendLine)(this.s, line.id, uv[0], uv[1]);
        this.resolve();
      }
      this.render();
      return;
    }
    const snap = this.snap(e);
    if (!snap) return;
    this.chain.push(snap);
    if (this.tool === "line") {
      if (this.chain.length >= 2) {
        const closed = this.addLine(this.chain[this.chain.length - 2], snap);
        if (closed) this.endChain();
        else this.chain = [snap];
      }
    } else if ((this.tool === "rectangle" || this.tool === "rectcentre") && this.chain.length === 2) {
      this.addRectangle(this.chain[0], this.chain[1], this.tool === "rectcentre");
      this.chain = [];
    } else if (this.tool === "circle" && this.chain.length === 2) {
      this.addCircle(this.chain[0], this.chain[1]);
      this.chain = [];
    } else if (POLYGON_SIDES[this.tool] && this.chain.length === 2) {
      this.addPolygon(this.chain[0], this.chain[1], POLYGON_SIDES[this.tool]!);
      this.chain = [];
    } else if (this.tool === "arc" && this.chain.length === 3) {
      this.addArc(this.chain[0], this.chain[1], this.chain[2]);
      this.chain = [];
    }
    this.cursor = null;
    this.render();
  }

  private endChain() {
    this.chain = [];
    this.chainStart = undefined;
    this.cursor = null;
    this.render();
  }

  private onKey(e: KeyboardEvent) {
    if (!this.active) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, select, textarea")) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.undo();
    } else if (e.key === "Escape") {
      if (this.chain.length) this.endChain();
      else if (this.tool !== "select") this.setTool("select");
      else if (this.selection.length) this.selection = [], this.render();
      else this.exit(); // nothing left to cancel: leave the sketch so face picking works again
    } else if (e.key === "Enter" && this.chain.length) {
      this.endChain();
    } else if ((e.key === "Delete" || e.key === "Backspace") && this.selection.length) {
      this.pushUndo();
      for (const sel of this.selection) {
        const reference = sel.kind === "entity" ? this.s.entities.find((e) => e.id === sel.id)?.reference : this.s.points.find((p) => p.id === sel.id)?.fixed;
        if (!reference) this.s = M.remove(this.s, sel); // the face outline stays
      }
      this.selection = [];
      this.resolve();
      this.render();
    }
  }

  // Editing -----------------------------------------------------------------------------------------

  private pushUndo() {
    this.undoStack.push(JSON.stringify(this.s));
    if (this.undoStack.length > 100) this.undoStack.shift();
  }

  private undo() {
    const last = this.undoStack.pop();
    if (!last) return;
    this.s = JSON.parse(last);
    this.selection = [];
    this.chain = [];
    this.resolve();
    this.render();
  }

  /** The id of an existing or new point for a clicked position. */
  private pointFor(snap: Snap): number {
    if (snap.id !== undefined) return snap.id;
    const id = M.nextId(this.s);
    this.s.points.push({ id, u: snap.u, v: snap.v });
    snap.id = id;
    return id;
  }

  private addConstraintRaw(c: Omit<M.SketchConstraint, "id">) {
    this.s.constraints.push({ id: M.nextId(this.s), ...c });
  }

  /** Returns true if the line ended on the first point of the chain (a closed outline). */
  private addLine(a: Snap, b: Snap): boolean {
    this.pushUndo();
    const first = this.chainStart;
    if (!this.chainStart) this.chainStart = a;
    const ia = this.pointFor(a);
    const ib = this.pointFor(b);
    if (ia === ib) return false;
    const id = M.nextId(this.s);
    this.s.entities.push({ id, type: "line", a: ia, b: ib });
    if (b.axis === "h") this.addConstraintRaw({ type: "horizontal", entity: id });
    if (b.axis === "v") this.addConstraintRaw({ type: "vertical", entity: id });
    this.resolve();
    const closed = first !== undefined && first.id === ib && first !== a;
    if (closed) this.chainStart = undefined;
    return closed;
  }
  private chainStart?: Snap;

  /** Corner to corner, or (centred) from the centre to a corner; optional rounded or bevelled corners. */
  private addRectangle(a: Snap, b: Snap, centred = false) {
    const [u0, u1] = centred ? [2 * a.u - b.u, b.u].sort((x, y) => x - y) : [a.u, b.u].sort((x, y) => x - y);
    const [v0, v1] = centred ? [2 * a.v - b.v, b.v].sort((x, y) => x - y) : [a.v, b.v].sort((x, y) => x - y);
    if (u1 - u0 < 1e-6 || v1 - v0 < 1e-6) return;
    this.pushUndo();
    const { corner } = this.rectOptions;
    const size = Math.min(this.rectOptions.size, (Math.min(u1 - u0, v1 - v0) / 2) * 0.999);
    if (corner === "none" || size < 1e-6) {
      // Snapped corners (existing points) stay in use; the other two are new.
      const corners: Snap[] = [{ u: u0, v: v0 }, { u: u1, v: v0 }, { u: u1, v: v1 }, { u: u0, v: v1 }].map((c) => (!centred ? [a, b].find((o) => o.id !== undefined && o.u === c.u && o.v === c.v) : undefined) ?? c);
      const p = corners.map((c) => this.pointFor(c));
      const ids = p.map((_, k) => this.addLineBetween(p[k], p[(k + 1) % 4]));
      ids.forEach((id, k) => this.addConstraintRaw({ type: k % 2 === 0 ? "horizontal" : "vertical", entity: id }));
      this.resolve();
      return;
    }
    // Going counterclockwise: each side runs between its two trimmed ends, each corner is an arc or a bevel.
    const r = size;
    const side = (u: number, v: number) => this.pointFor({ u, v } as Snap);
    const ends: [number, number][][] = [
      [[u0 + r, v0], [u1 - r, v0]],
      [[u1, v0 + r], [u1, v1 - r]],
      [[u1 - r, v1], [u0 + r, v1]],
      [[u0, v1 - r], [u0, v0 + r]],
    ];
    const pts = ends.map((e) => e.map(([u, v]) => side(u, v)));
    const centres: [number, number][] = [[u1 - r, v0 + r], [u1 - r, v1 - r], [u0 + r, v1 - r], [u0 + r, v0 + r]];
    const sides = pts.map(([from, to]) => this.addLineBetween(from, to));
    sides.forEach((id, k) => this.addConstraintRaw({ type: k % 2 === 0 ? "horizontal" : "vertical", entity: id }));
    for (let k = 0; k < 4; k++) {
      const start = pts[k][1];
      const end = pts[(k + 1) % 4][0];
      if (corner === "chamfer") {
        this.addLineBetween(start, end);
        continue;
      }
      const centre = this.pointFor({ u: centres[k][0], v: centres[k][1] } as Snap);
      const arc = M.nextId(this.s);
      this.s.entities.push({ id: arc, type: "arc", center: centre, start, end });
      this.addConstraintRaw({ type: "tangent", entities: [arc, sides[k]] });
      this.addConstraintRaw({ type: "tangent", entities: [arc, sides[(k + 1) % 4]] });
    }
    this.resolve();
  }

  private addLineBetween(a: number, b: number): number {
    const id = M.nextId(this.s);
    this.s.entities.push({ id, type: "line", a, b });
    return id;
  }
  private rectOptions: { corner: "none" | "fillet" | "chamfer"; size: number } = { corner: "none", size: 5 };

  private polygonCorners(center: { u: number; v: number }, corner: { u: number; v: number }, sides: number): { u: number; v: number }[] {
    const radius = Math.hypot(corner.u - center.u, corner.v - center.v);
    const start = Math.atan2(corner.v - center.v, corner.u - center.u);
    return Array.from({ length: sides }, (_, k) => ({
      u: center.u + radius * Math.cos(start + (2 * Math.PI * k) / sides),
      v: center.v + radius * Math.sin(start + (2 * Math.PI * k) / sides),
    }));
  }

  private addPolygon(center: Snap, corner: Snap, sides: number) {
    if (Math.hypot(corner.u - center.u, corner.v - center.v) < 1e-6) return;
    this.pushUndo();
    const p = this.polygonCorners(center, corner, sides).map((c) => this.pointFor(c as Snap));
    const ids = p.map((_, k) => {
      const id = M.nextId(this.s);
      this.s.entities.push({ id, type: "line", a: p[k], b: p[(k + 1) % sides] });
      return id;
    });
    // Equal sides keep it regular when a corner is dragged; the corners stay free.
    ids.slice(1).forEach((id) => this.addConstraintRaw({ type: "equal", entities: [ids[0], id] }));
    this.resolve();
  }

  private addCircle(center: Snap, edge: Snap) {
    const radius = Math.hypot(edge.u - center.u, edge.v - center.v);
    if (radius < 1e-6) return;
    this.pushUndo();
    const c = this.pointFor(center);
    this.s.entities.push({ id: M.nextId(this.s), type: "circle", center: c, radius });
    this.resolve();
  }

  private addArc(center: Snap, start: Snap, end: Snap) {
    const radius = Math.hypot(start.u - center.u, start.v - center.v);
    if (radius < 1e-6) return;
    this.pushUndo();
    const angle = Math.atan2(end.v - center.v, end.u - center.u);
    const c = this.pointFor(center);
    const s = this.pointFor(start);
    const e = this.pointFor({ u: center.u + radius * Math.cos(angle), v: center.v + radius * Math.sin(angle) });
    this.s.entities.push({ id: M.nextId(this.s), type: "arc", center: c, start: s, end: e });
    this.resolve();
  }

  private setTool(tool: Tool) {
    this.tool = tool;
    this.chain = [];
    this.chainStart = undefined;
    this.cursor = null;
    this.hover = null;
    this.host.status(`Sketch ${TOOLS.find((t) => t.id === tool)!.label}: ${TOOLS.find((t) => t.id === tool)!.hint}`);
    this.render();
  }

  private async applyConstraint(option: M.ConstraintOption) {
    const built = option.build(this.s, this.selection);
    if (!built) return;
    if (option.dimension) {
      const value = await this.askNumber(option.label, option.initial!(this.s, this.selection));
      if (value === null) return;
      built.value = value;
    }
    this.pushUndo();
    const before = JSON.stringify(this.s);
    this.s.constraints.push({ id: M.nextId(this.s), ...built });
    const ok = await this.resolve();
    if (!ok) {
      this.s = JSON.parse(before);
      this.undoStack.pop();
      await this.resolve();
      this.host.status("That constraint conflicts with the existing ones (or is redundant), so it was not added", true);
    }
    this.render();
  }

  private askNumber(label: string, initial: number): Promise<number | null> {
    return new Promise((resolve) => {
      const box = this.panel.querySelector<HTMLElement>(".ask")!;
      box.hidden = false;
      box.replaceChildren();
      const text = document.createElement("span");
      text.textContent = label;
      const input = document.createElement("input");
      input.type = "number";
      input.step = "any";
      input.value = String(parseFloat(initial.toFixed(3)));
      const done = (value: number | null) => {
        box.hidden = true;
        box.replaceChildren();
        resolve(value);
      };
      const ok = document.createElement("button");
      ok.textContent = "OK";
      ok.addEventListener("click", () => done(Number.isFinite(Number(input.value)) ? Number(input.value) : null));
      const cancel = document.createElement("button");
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => done(null));
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") ok.click();
        else if (e.key === "Escape") done(null);
      });
      box.append(text, input, ok, cancel);
      input.focus();
      input.select();
    });
  }

  // Solving -----------------------------------------------------------------------------------------

  /** Solve the constraints (latest request wins while one is in flight). Resolves true if the solver succeeded. */
  private resolve(drag?: { point: number; u: number; v: number }): Promise<boolean> {
    this.queued = { drag };
    if (this.solving) return Promise.resolve(true);
    return this.runSolve();
  }

  private async runSolve(): Promise<boolean> {
    this.solving = true;
    let ok = true;
    try {
      while (this.queued) {
        const job = this.queued;
        this.queued = null;
        let reply: SolveReply;
        try {
          reply = await this.core.request<SolveReply>("sketch_solve", { sketch: this.s, drag: job.drag });
        } catch (e) {
          this.host.status((e as Error).message, true);
          ok = false;
          continue;
        }
        if (reply.status === "ok") {
          const byId = new Map(reply.points.map((p) => [p.id, p]));
          for (const p of this.s.points) {
            const q = byId.get(p.id);
            if (q) [p.u, p.v] = [q.u, q.v];
          }
          for (const e of this.s.entities) if (e.type === "circle" && String(e.id) in reply.radii) e.radius = reply.radii[String(e.id)];
          this.dof = reply.dof;
          this.failed.clear();
          ok = true;
        } else if (!job.drag) {
          this.failed = new Set(reply.failed.filter((x): x is number => x !== null));
          ok = false;
        }
        this.render();
      }
    } finally {
      this.solving = false;
    }
    return ok;
  }

  // Extrusion ---------------------------------------------------------------------------------------

  private schedulePreview() {
    clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => this.sendExtrude(false), PREVIEW_DELAY_MS);
  }

  private async sendExtrude(commit: boolean) {
    if (!this.extrude.open) return;
    try {
      const e = this.extrude;
      const request: Record<string, unknown> = { sketch: this.s, mode: e.mode, commit };
      if (e.revolve) {
        const axis = this.selectedLine();
        if (axis === null) throw new Error("Select one line in the sketch as the axis to revolve about");
        Object.assign(request, { axis, distance: e.angle });
      } else {
        Object.assign(request, { distance: e.distance, symmetric: e.symmetric });
      }
      const mesh = await this.core.request<MeshData>("sketch_extrude", request);
      if (commit) {
        this.extrude.open = false;
        this.exitAfterCommit(mesh);
      } else {
        this.host.showPreview(mesh);
        this.host.status(this.extrude.revolve ? "Revolve preview" : "Extrude preview");
      }
    } catch (e) {
      this.host.status((e as Error).message, true);
      if (!commit) this.host.restore();
    }
  }

  /** The id of the single selected line, or null. */
  private selectedLine(): number | null {
    const picked = this.selection.filter((x) => x.kind === "entity");
    const line = picked.length === 1 ? this.s.entities.find((en) => en.id === picked[0].id) : undefined;
    return line && line.type === "line" ? line.id : null;
  }

  private toggleConstruction() {
    const ids = new Set(this.selection.filter((x) => x.kind === "entity").map((x) => x.id));
    if (!ids.size) return;
    this.pushUndo();
    for (const en of this.s.entities) if (ids.has(en.id)) en.construction = !en.construction;
    this.render();
  }

  private exitAfterCommit(mesh: MeshData) {
    this.exit();
    this.host.committed(mesh);
  }

  // Drawing -----------------------------------------------------------------------------------------

  private onFrame() {
    const size = this.viewport.renderer.getSize(new THREE.Vector2());
    for (const l of [this.normal, this.construction, this.marked, this.pending]) l.material.resolution.set(size.x, size.y);
  }

  private world(u: number, v: number): THREE.Vector3 {
    return new THREE.Vector3(...M.toWorld(this.s.plane, u, v));
  }

  private segments(lines: [number, number][][]): number[] {
    const out: number[] = [];
    for (const line of lines) {
      for (let i = 0; i + 1 < line.length; i++) out.push(...this.world(...line[i]).toArray(), ...this.world(...line[i + 1]).toArray());
    }
    return out;
  }

  private isMarked(sel: M.SketchSel) {
    return this.selection.some((s) => s.kind === sel.kind && s.id === sel.id) || (this.hover?.kind === sel.kind && this.hover.id === sel.id);
  }

  private render() {
    if (!this.active) return;
    const normal: [number, number][][] = [];
    const marked: [number, number][][] = [];
    const guides: [number, number][][] = [];
    for (const e of this.s.entities) (this.isMarked({ kind: "entity", id: e.id }) ? marked : e.construction ? guides : normal).push(M.polyline(this.s, e));
    this.set(this.normal, this.segments(normal));
    this.set(this.construction, this.segments(guides));
    this.set(this.marked, this.segments(marked));
    this.set(this.pending, this.segments(this.pendingShapes()));

    const positions: number[] = [];
    const colors: number[] = [];
    const color = new THREE.Color();
    for (const p of this.s.points) {
      positions.push(...this.world(p.u, p.v).toArray());
      color.set(this.isMarked({ kind: "point", id: p.id }) ? COLORS.selected : this.cursor?.id === p.id ? COLORS.hover : p.fixed ? COLORS.construction : COLORS.line);
      colors.push(color.r, color.g, color.b);
    }
    this.points.geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    this.points.geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    this.points.geometry.computeBoundingSphere();
    this.overlay.set(M.dimensionsOf(this.s));
    this.renderPanel();
  }

  private set(line: LineSegments2, positions: number[]) {
    line.visible = positions.length > 0;
    if (!positions.length) return;
    // A fresh geometry each time: reusing one whose segment count grows left it drawing only the first segments.
    line.geometry.dispose();
    line.geometry = new LineSegmentsGeometry().setPositions(positions);
  }

  /** Rubber-band shapes for the drawing in progress. */
  private pendingShapes(): [number, number][][] {
    const c = this.cursor;
    const first = this.chain[0];
    if (!c || !first) return [];
    if (this.tool === "line") {
      const last = this.chain[this.chain.length - 1];
      return [[[last.u, last.v], [c.u, c.v]]];
    }
    if (this.tool === "rectangle") return [[[first.u, first.v], [c.u, first.v], [c.u, c.v], [first.u, c.v], [first.u, first.v]]];
    if (this.tool === "rectcentre") {
      const [x, y] = [2 * first.u - c.u, 2 * first.v - c.v];
      return [[[x, y], [c.u, y], [c.u, c.v], [x, c.v], [x, y]]];
    }
    const sides = POLYGON_SIDES[this.tool];
    if (sides) {
      const corners = this.polygonCorners(first, c, sides).map((q) => [q.u, q.v] as [number, number]);
      return [[...corners, corners[0]]];
    }
    const r = Math.hypot(c.u - first.u, c.v - first.v);
    if (this.tool === "circle") return [Array.from({ length: 49 }, (_, i) => [first.u + r * Math.cos((2 * Math.PI * i) / 48), first.v + r * Math.sin((2 * Math.PI * i) / 48)] as [number, number])];
    if (this.tool === "arc") {
      const second = this.chain[1];
      if (!second) return [[[first.u, first.v], [c.u, c.v]]];
      const radius = Math.hypot(second.u - first.u, second.v - first.v);
      const a0 = Math.atan2(second.v - first.v, second.u - first.u);
      let sweep = Math.atan2(c.v - first.v, c.u - first.u) - a0;
      if (sweep <= 0) sweep += 2 * Math.PI;
      return [Array.from({ length: 49 }, (_, i) => [first.u + radius * Math.cos(a0 + (sweep * i) / 48), first.v + radius * Math.sin(a0 + (sweep * i) / 48)] as [number, number])];
    }
    return [];
  }

  // Panel -------------------------------------------------------------------------------------------

  private renderPanel() {
    const keepAsk = this.panel.querySelector<HTMLElement>(".ask");
    const asking = keepAsk && !keepAsk.hidden;
    if (asking) return; // do not rebuild while a value is being typed
    this.panel.hidden = false;
    const el = (tag: string, cls = "", text = "") => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text) e.textContent = text;
      return e;
    };
    const button = (label: string, on: () => void, cls = "") => {
      const b = el("button", cls, label) as HTMLButtonElement;
      b.addEventListener("click", on);
      return b;
    };

    const header = el("div", "title", "Sketch");
    const status = el("div", "dof", this.failed.size ? `Conflict in constraints: ${[...this.failed].join(", ")}` : this.dof === null ? "" : this.dof === 0 ? "Fully constrained" : `${this.dof} degrees of freedom left`);
    if (this.failed.size) status.classList.add("bad");

    const tools = el("div", "row-buttons");
    for (const t of TOOLS) {
      const b = button(t.label, () => this.setTool(t.id), t.id === this.tool ? "active" : "");
      b.title = t.hint;
      tools.append(b);
    }

    if (this.tool === "rectangle" || this.tool === "rectcentre") {
      const corner = document.createElement("select");
      for (const [v, label] of [["none", "Square corners"], ["fillet", "Rounded corners"], ["chamfer", "Bevelled corners"]]) corner.append(new Option(label, v, false, v === this.rectOptions.corner));
      corner.addEventListener("change", () => (this.rectOptions.corner = corner.value as "none" | "fillet" | "chamfer"));
      const size = document.createElement("input");
      size.type = "number";
      size.step = "any";
      size.min = "0";
      size.value = String(this.rectOptions.size);
      size.title = "Corner radius or bevel size";
      size.addEventListener("keydown", (e) => e.stopPropagation());
      size.addEventListener("input", () => (this.rectOptions.size = Math.abs(Number(size.value)) || 0));
      const row = el("div", "row-buttons");
      row.append(corner, size);
      tools.append(row);
    }

    const options = M.optionsFor(this.s, this.selection);
    const constraints = el("div", "row-buttons");
    constraints.append(...options.map((o) => button(o.label, () => this.applyConstraint(o))));
    const constraintsBox = el("div", "section");
    constraintsBox.append(el("div", "group", this.selection.length ? "Constrain selection" : "Select items to constrain"), constraints);

    const ask = el("div", "ask");
    ask.hidden = true;

    const list = el("div", "section");
    list.append(el("div", "group", `Constraints (${this.s.constraints.length})`));
    for (const c of this.s.constraints) {
      const row = el("div", this.failed.has(c.id) ? "crow bad" : "crow");
      row.append(el("span", "", M.describeConstraint(this.s, c)));
      row.append(
        button("✕", () => {
          this.pushUndo();
          this.s.constraints = this.s.constraints.filter((x) => x.id !== c.id);
          this.resolve();
          this.render();
        }),
      );
      list.append(row);
    }

    const extrude = el("div", "section");
    const preview = (change: () => void) => {
      change();
      this.extrude.open = true;
      this.schedulePreview();
    };
    const number = (value: number, on: (n: number) => void) => {
      const input = document.createElement("input");
      input.type = "number";
      input.step = "any";
      input.value = String(value);
      input.addEventListener("keydown", (e) => e.stopPropagation());
      input.addEventListener("input", () => preview(() => on(Number(input.value))));
      return input;
    };
    const mode = document.createElement("select");
    for (const m of ["join", "cut"]) mode.append(new Option(m === "join" ? "Join (add material)" : "Cut (remove material)", m, false, m === this.extrude.mode));
    mode.addEventListener("change", () => preview(() => (this.extrude.mode = mode.value as "join" | "cut")));
    const symmetric = document.createElement("input");
    symmetric.type = "checkbox";
    symmetric.checked = this.extrude.symmetric;
    symmetric.addEventListener("change", () => preview(() => (this.extrude.symmetric = symmetric.checked)));
    const symmetricLabel = el("label", "crow");
    symmetricLabel.append(el("span", "", "Both directions"), symmetric);

    extrude.append(el("div", "group", "Extrude profile"));
    const row = el("div", "crow");
    row.append(number(this.extrude.distance, (n) => ((this.extrude.distance = n), (this.extrude.revolve = false))), mode);
    const go = el("div", "row-buttons");
    go.append(
      button("Preview", () => {
        this.extrude.revolve = false;
        this.extrude.open = true;
        this.sendExtrude(false);
      }),
      button("Extrude", () => {
        this.extrude.revolve = false;
        this.extrude.open = true;
        this.sendExtrude(true);
      }, "active"),
    );
    extrude.append(row, symmetricLabel, go);

    extrude.append(el("div", "group", "Revolve about the selected line"));
    const spin = el("div", "crow");
    spin.append(number(this.extrude.angle, (n) => ((this.extrude.angle = n), (this.extrude.revolve = true))), el("span", "", "degrees"));
    const spinGo = el("div", "row-buttons");
    spinGo.append(
      button("Preview", () => {
        this.extrude.revolve = true;
        this.extrude.open = true;
        this.sendExtrude(false);
      }),
      button("Revolve", () => {
        this.extrude.revolve = true;
        this.extrude.open = true;
        this.sendExtrude(true);
      }, "active"),
    );
    extrude.append(spin, spinGo);

    if (this.selection.some((x) => x.kind === "entity")) {
      const construction = button("Toggle construction", () => this.toggleConstruction());
      construction.title = "Construction geometry guides the sketch but is not part of the profile (use it as a revolve axis)";
      constraintsBox.append(construction);
    }

    const finish = button("Finish sketch", () => this.finish());
    finish.title = "Leave the sketch and keep its closed regions as faces you can push/pull or extrude";
    const exit = button("Discard sketch", () => this.exit());
    this.panel.replaceChildren(header, status, tools, constraintsBox, ask, list, extrude, finish, exit);
  }
}
