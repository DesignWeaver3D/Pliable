/**
 * Sketch mode: draw on a plane in the 3D view (no separate workbench), constrain with the solver in the core,
 * then extrude the profile. All sketch rules live in sketchmodel.ts; this file is the interaction and drawing.
 */
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { CoreClient, MeshData } from "./client";
import type { Dimension, DimensionOverlay } from "./dimensions";
import * as Chk from "./sketchcheck";
import * as E from "./sketchedit";
import * as M from "./sketchmodel";
import * as Sh from "./sketchshapes";
import { uiIcon } from "./icons";
import { LENGTH_UNIT } from "./units";
import { usage } from "./usage";
import type { Viewport } from "./viewport";

const SNAP_PX = 10; // pointer snaps to an existing sketch point this close
const PICK_PX = 8; // pick radius for points and curves in the select tool
const AUTO_AXIS_DEG = 3; // a line drawn within this angle of horizontal/vertical becomes exactly so
const DRAG_START_PX = 3;
const POINT_SIZE_PX = 8;
const PREVIEW_DELAY_MS = 150;
const COLORS = { line: 0x7fd1ff, selected: 0xff8a1f, hover: 0xffffff, pending: 0xffe066, construction: 0x7f8794, grid: 0x3a4150, placed: 0x8fe388, conflict: 0xff5a5a };

export type Tool = "select" | "line" | "rectangle" | "rectcentre" | "circle" | "circle3" | "arc" | "arc3" | "slot" | "point" | "ellipse" | "spline" | "trim" | "extend" | "split" | "triangle" | "pentagon" | "hexagon" | "octagon";
/** Regular polygon tools: the centre then a corner; the number of sides is the only difference between them. */
const POLYGON_SIDES: Partial<Record<Tool, number>> = { triangle: 3, pentagon: 5, hexagon: 6, octagon: 8 };
export const SKETCH_TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: "select", label: "Select", hint: "Click to select, drag points, Delete removes" },
  { id: "line", label: "Line", hint: "Click points; Enter or right-click ends the chain" },
  { id: "rectangle", label: "Rectangle", hint: "Click two opposite corners" },
  { id: "rectcentre", label: "Centre rectangle", hint: "Click the centre, then a corner" },
  { id: "circle", label: "Circle", hint: "Click the centre, then a point on the circle" },
  { id: "circle3", label: "Circle by 3 points", hint: "Click three points the circle passes through" },
  { id: "arc", label: "Arc", hint: "Click the centre, the start, then the end (counterclockwise)" },
  { id: "arc3", label: "Arc by 3 points", hint: "Click the start, a point the arc passes through, then the end" },
  { id: "slot", label: "Slot", hint: "Click the centre of one end, the centre of the other end, then a point for the width" },
  { id: "point", label: "Point", hint: "Click to place a point; it can be snapped to and constrained" },
  { id: "ellipse", label: "Ellipse", hint: "Click the centre, the end of the long axis, then a point for the short radius" },
  { id: "spline", label: "Spline", hint: "Click points the curve passes through; Enter or right-click ends it, clicking the first point closes it" },
  { id: "trim", label: "Trim", hint: "Click the part of a line to remove, up to the nearest crossing curves" },
  { id: "split", label: "Split", hint: "Click a line where it should be cut in two" },
  { id: "extend", label: "Extend", hint: "Click near the end of a line to stretch it to the next curve" },
  ...(Object.keys(POLYGON_SIDES) as Tool[]).map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), hint: "Click the centre, then a corner" })),
];

/** Sketch preferences kept on this computer: the grid and which constraints the drawing tools add on their own. */
export interface SketchOptions {
  grid: boolean;
  /** Pointer positions snap to the grid while drawing. */
  snapGrid: boolean;
  /** Spacing of the bold grid lines, in the length unit (mm). */
  major: number;
  /** Spacing of the light lines between them, in the length unit; 0 draws none. The pointer snaps to this when it is set, else to the major spacing. */
  minor: number;
  /** none: tools add no constraints; snaps: only those a snap implies (horizontal, vertical, on a curve, tangent); shape: also the ones that keep a rectangle, polygon or slot its shape. */
  auto: "none" | "snaps" | "shape";
}
const OPTIONS_KEY = "pliable.sketchOptions2";

export function loadSketchOptions(): SketchOptions {
  const options: SketchOptions = { grid: false, snapGrid: false, major: 10, minor: 2, auto: "none" };
  try {
    const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "null");
    if (saved) {
      options.grid = saved.grid === true;
      options.snapGrid = saved.snapGrid === true;
      if (Number.isFinite(saved.major) && saved.major > 0) options.major = saved.major;
      if (Number.isFinite(saved.minor) && saved.minor >= 0) options.minor = saved.minor;
      if (["none", "snaps", "shape"].includes(saved.auto)) options.auto = saved.auto;
    }
  } catch {
    // no saved options (or storage is blocked): the defaults stand
  }
  return options;
}

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
  /** The curve this snap landed on, and whether it was a line's midpoint: becomes a constraint on the new point. */
  on?: { entity: number; midpoint?: boolean };
  /** A circle being drawn touches this entity (set by the circle tool's tangent snap). */
  tangent?: number;
  /** Dotted guide lines to show: the cursor lined up with existing points. */
  guides?: [number, number][][];
}
interface SolveReply {
  status: "ok" | "failed";
  dof: number | null;
  failed: (number | null)[];
  points: { id: number; u: number; v: number }[];
  radii: Record<string, number>;
  /** Only when nothing is being dragged. On success: directions each point can still move in. On failure: constraints to blame. */
  freedom?: Record<string, number>;
  conflicts?: number[];
}

type Drag = { point: number; u: number; v: number } | { points: { point: number; u: number; v: number }[] };

export class SketchMode {
  active = false;
  private s!: M.SketchData;
  private plane = new THREE.Plane();
  private tool: Tool = "select";
  private selection: M.SketchSel[] = [];
  private hover: M.SketchSel | null = null;
  /** Geometry lit up while the pointer is over a row of the constraint list. */
  private highlight: M.SketchSel[] = [];
  private chain: Snap[] = []; // points clicked so far for the current drawing
  private cursor: Snap | null = null;
  private drag: { id: number; startX: number; startY: number; moved: boolean; body?: { u: number; v: number; points: { id: number; u: number; v: number }[] } } | null = null;
  private dof: number | null = null;
  private failed = new Set<number>();
  /** Directions each point can still move in (0 = placed by the constraints); empty until the first settled solve. */
  private freedom = new Map<number, number>();
  /** Whether small tags (H, V, T, =, ...) show where constraints act. */
  private showMarks = true;
  private undoStack: string[] = [];
  private group = new THREE.Group();
  private normal = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: COLORS.line, linewidth: 2, depthTest: false }));
  private construction = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: COLORS.construction, linewidth: 2, depthTest: false }));
  private placed = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: COLORS.placed, linewidth: 2, depthTest: false }));
  private marked = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: COLORS.selected, linewidth: 3, depthTest: false }));
  /** The model's principal axes as they project onto the sketch plane (red x, green y, blue z). */
  private axes = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ linewidth: 1, vertexColors: true, depthTest: false, transparent: true, opacity: 0.7 }));
  private pending = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: COLORS.pending, linewidth: 2, depthTest: false }));
  private points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: POINT_SIZE_PX, sizeAttenuation: false, vertexColors: true, depthTest: false }));
  private grid: THREE.Group | null = null;
  private options = loadSketchOptions();
  private settingsDialog: HTMLDialogElement | null = null;
  /** Called when the active drawing tool, or whether a sketch is open, changes (the top strip redraws). */
  onToolChange: (() => void) | null = null;

  get activeTool(): Tool {
    return this.tool;
  }

  /** Choose a drawing tool (from the top strip). */
  selectTool(tool: Tool) {
    if (this.active) this.setTool(tool);
  }
  private solving = false;
  private queued: { drag?: Drag } | null = null;
  private previewTimer = 0;
  private panel: HTMLElement;
  private extrude = { distance: 10, mode: "join" as "join" | "cut" | "new", symmetric: false, revolve: false, angle: 360, open: false };

  constructor(
    private readonly viewport: Viewport,
    private readonly core: CoreClient,
    private readonly overlay: DimensionOverlay,
    private readonly host: SketchHost,
    panel: HTMLElement,
  ) {
    this.panel = panel;
    window.addEventListener("keydown", this.onTyping, true);
    for (const o of [this.normal, this.placed, this.construction, this.points]) o.userData.extent = true; // counted by the origin axes' length
    for (const o of [this.axes, this.normal, this.placed, this.construction, this.marked, this.pending, this.points]) {
      o.renderOrder = 5;
      o.frustumCulled = false;
      this.group.add(o);
    }
    // Keys reach onKey through the key router (keyrouter.ts), which applies the shortcut policy first.
    viewport.renderer.domElement.addEventListener("contextmenu", () => {
      if (this.active && this.chain.length) this.endChain();
    });
  }

  // Entering and leaving ----------------------------------------------------------------------------

  /** Set while sketching on an unrolled cylinder face: the face the regions are wrapped back onto when finishing. */
  private unwrapFace: number[] | null = null;

  /** A kept sketch being edited: its id and name in the document; null for a new sketch. */
  private kept: { id: number; name: string } | null = null;
  /** Whether Finish also turns the closed regions into faces of the model (on for a new sketch, off when reopening one). */
  private makeFaces = true;
  /** Called with the id of the kept sketch being edited, or null when none is, so the sketch list can hide its copy of it. */
  onEditing: ((id: number | null) => void) | null = null;

  start(plane: M.PlaneData, reference?: { points: M.SketchPoint[]; entities: M.SketchEntity[] }, unwrapFace: number[] | null = null, distortion?: { max: number; note: string }, kept?: { id: number; name: string; sketch: any }) {
    if (this.active) this.exit();
    // Reference geometry (the face outline) is fixed construction geometry that sketch points can snap to.
    this.s = kept
      ? { plane: kept.sketch.plane, points: kept.sketch.points ?? [], entities: kept.sketch.entities ?? [], constraints: kept.sketch.constraints ?? [] }
      : { plane, points: reference?.points ?? [], entities: reference?.entities ?? [], constraints: [] };
    this.kept = kept ? { id: kept.id, name: kept.name } : null;
    this.makeFaces = !kept;
    this.onEditing?.(this.kept?.id ?? null);
    // The model origin and the places where the principal axes meet the plane are fixed points too.
    this.unwrapFace = kept ? (kept.sketch.unwrap ?? null) : unwrapFace;
    if (!kept && unwrapFace === null) {
      // The sketch origin is the centre of the face (or the plane's origin): a fixed point to snap to and constrain against.
      if (!this.s.points.some((p) => Math.hypot(p.u, p.v) < 1e-6)) this.s.points.push({ id: M.nextId(this.s), u: 0, v: 0, fixed: true });
      for (const o of M.originPoints(plane, this.s.points)) this.s.points.push({ id: M.nextId(this.s), u: o.u, v: o.v, fixed: true });
    }
    const f = M.frame(this.s.plane);
    this.plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(...f.n), new THREE.Vector3(...f.origin));
    this.tool = "select";
    this.selection = [];
    this.chain = [];
    this.dof = null;
    this.failed.clear();
    this.freedom.clear();
    this.undoStack = [];
    this.extrude = { distance: 10, mode: "join", symmetric: false, revolve: false, angle: 360, open: false };
    this.active = true;
    this.viewport.selectItems([]); // the model's selection highlight would cover the sketch
    this.viewport.manipulator.clear(); // so would the selected face's push/pull arrow
    this.buildGrid(f);
    this.viewport.scene.add(this.group);
    this.viewport.interceptor = { down: (e) => this.onDown(e), move: (e) => this.onMove(e), up: (e) => this.onUp(e) };
    this.viewport.onFrame2 = () => this.onFrame();
    this.render();
    this.onToolChange?.();
    this.host.status(distortion ? distortion.note : "Sketch: choose a drawing tool in the top bar (Line, Rectangle, Circle, Arc)", !!distortion);
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
      this.disposeGrid(this.grid);
      this.grid = null;
    }
    this.overlay.set([]);
    this.panel.hidden = true;
    this.panel.replaceChildren();
    this.host.restore();
    this.onToolChange?.();
    this.kept = null;
    this.onEditing?.(null);
    this.host.status("Sketch closed");
  }

  /** Leave the sketch keeping its closed regions as faces of the model; with no closed outline just leave. */
  async finish() {
    if (!this.active) return;
    clearTimeout(this.previewTimer);
    const drawn = this.s.entities.some((e) => !e.reference);
    if (!drawn && !this.kept) return this.exit(); // nothing was drawn: nothing to keep
    const keepRequest = (regions: boolean) => ({
      sketch: { ...this.s, ...(this.unwrapFace ? { unwrap: this.unwrapFace } : {}) },
      ...(this.kept ? { sketch_id: this.kept.id } : {}),
      regions,
      ...(this.unwrapFace ? { unwrap: this.unwrapFace } : {}),
    });
    let note = "";
    try {
      let mesh: MeshData;
      try {
        mesh = await this.core.request<MeshData>("sketch_keep", keepRequest(this.makeFaces));
        if (this.makeFaces) note = " Its closed regions are faces now.";
      } catch (e) {
        if (!this.makeFaces) throw e;
        mesh = await this.core.request<MeshData>("sketch_keep", keepRequest(false)); // no closed outline: keep the curves alone
        note = ` It was kept without faces (${(e as Error).message}).`;
      }
      this.exit();
      this.host.committed(mesh);
      usage.record("sketch_finish", "commit");
      this.host.status(`Sketch kept.${note}`);
    } catch (e) {
      this.exit();
      this.host.status((e as Error).message);
    }
  }

  /** The distance the pointer snaps to when snap to grid is on: the light lines when there are any, else the bold ones. */
  private gridStep(): number {
    const { major, minor } = this.options;
    return minor > 0 && minor < major ? minor : major;
  }

  private saveOptions() {
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(this.options));
    } catch {
      // storage blocked: the choice lasts for this session only
    }
  }

  private disposeGrid(grid: THREE.Group) {
    for (const child of grid.children) {
      const lines = child as THREE.LineSegments;
      lines.geometry.dispose();
      (lines.material as THREE.Material).dispose();
    }
  }

  /** The grid on the sketch plane: bold lines every `major` units and, if asked, lighter ones between them. */
  private buildGrid(f: ReturnType<typeof M.frame> = M.frame(this.s.plane)) {
    if (this.grid) {
      this.group.remove(this.grid);
      this.disposeGrid(this.grid);
      this.grid = null;
    }
    if (!this.options.grid) return;
    const { major, minor } = this.options;
    const size = major * 20;
    const layer = (divisions: number, color: number, opacity: number) => {
      const lines = new THREE.GridHelper(size, divisions, color, color);
      const material = lines.material as THREE.Material;
      material.depthTest = false;
      material.transparent = true;
      material.opacity = opacity;
      return lines;
    };
    const grid = new THREE.Group();
    if (minor > 0 && minor < major && size / minor <= 800) grid.add(layer(Math.round(size / minor), COLORS.grid, 0.25));
    grid.add(layer(20, COLORS.grid, 0.6));
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
    if (this.options.snapGrid) {
      const step = this.gridStep();
      [u, v] = [Math.round(u / step) * step, Math.round(v / step) * step];
    }
    let axis: Snap["axis"];
    const last = this.chain[this.chain.length - 1];
    if (this.tool === "line" && last) {
      const angle = (Math.atan2(v - last.v, u - last.u) * 180) / Math.PI;
      const fromH = Math.min(Math.abs(angle), Math.abs(Math.abs(angle) - 180));
      if (fromH < AUTO_AXIS_DEG) [v, axis] = [last.v, "h"];
      else if (Math.abs(Math.abs(angle) - 90) < AUTO_AXIS_DEG) [u, axis] = [last.u, "v"];
    }
    const pixel = this.viewport.pixelSizeAt(new THREE.Vector3(...M.toWorld(this.s.plane, u, v)));
    const reach = SNAP_PX * pixel;
    if (this.tool === "line" && this.chain.length >= 1) {
      const t = M.tangentFrom(this.s, this.chain[this.chain.length - 1], u, v, reach);
      if (t) return { u: t.u, v: t.v, tangent: t.entity, on: { entity: t.entity } };
    }
    if (this.tool === "circle" && this.chain.length === 1) {
      const t = M.tangentRadius(this.s, this.chain[0], u, v, reach);
      if (t) return { u: t.u, v: t.v, tangent: t.entity };
    }
    // Midpoints of lines, then the nearest point on a curve.
    for (const en of this.s.entities) {
      if (en.type !== "line") continue;
      const a = M.pointOf(this.s, en.a);
      const b = M.pointOf(this.s, en.b);
      const mid = [(a.u + b.u) / 2, (a.v + b.v) / 2];
      if (Math.hypot(u - mid[0], v - mid[1]) < reach) return { u: mid[0], v: mid[1], on: { entity: en.id, midpoint: true } };
    }
    for (const en of this.s.entities) {
      if (M.distanceTo(this.s, en, u, v) < reach) {
        const on = M.closestOn(this.s, en, u, v);
        if (on) return { u: on[0], v: on[1], on: { entity: en.id } };
      }
    }
    // The sketch's own axes, through the centre of the face (its origin).
    for (const a of M.sketchAxes(this.s.plane)) {
      const t = (u - a.u) * a.du + (v - a.v) * a.dv;
      const on: [number, number] = [a.u + t * a.du, a.v + t * a.dv];
      if (Math.hypot(u - on[0], v - on[1]) < reach) return { u: on[0], v: on[1] };
    }
    // Line up with the u or v of an existing point and show a guide to it.
    if (!axis) {
      let [su, sv] = [u, v];
      const hit = this.s.points.find((p) => Math.abs(p.u - u) < reach);
      const level = this.s.points.find((p) => Math.abs(p.v - v) < reach);
      if (hit) su = hit.u;
      if (level) sv = level.v;
      const guides: [number, number][][] = [];
      if (hit) guides.push([[hit.u, hit.v], [su, sv]]);
      if (level) guides.push([[level.u, level.v], [su, sv]]);
      if (guides.length) return { u: su, v: sv, guides };
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
      const body = this.drag.body;
      if (uv && body) this.resolve({ points: body.points.map((p) => ({ point: p.id, u: p.u + uv[0] - body.u, v: p.v + uv[1] - body.v })) });
      else if (uv) this.resolve({ point: this.drag.id, u: uv[0], v: uv[1] });
      return;
    }
    if (this.tool === "select" || this.tool === "trim" || this.tool === "extend" || this.tool === "split") this.hover = this.pick(e);
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
    // Dragging a line, circle or arc by its body moves its points together; the rest follows the constraints.
    const entity = hit?.kind === "entity" ? this.s.entities.find((x) => x.id === hit.id) : undefined;
    const uv = this.planeUV(e);
    if (entity && uv && !additive && !entity.reference) {
      const ids = M.entityPoints(entity);
      const held = ids.map((id) => this.s.points.find((p) => p.id === id)!);
      if (held.every((p) => p && !p.fixed)) {
        this.drag = { id: 0, startX: e.clientX, startY: e.clientY, moved: false, body: { u: uv[0], v: uv[1], points: held.map((p) => ({ id: p.id, u: p.u, v: p.v })) } };
        this.viewport.renderer.domElement.setPointerCapture(e.pointerId);
      }
    }
    this.render();
  }

  private async onUp(e: PointerEvent) {
    if (this.drag) {
      const moved = this.drag.moved;
      this.drag = null;
      if (moved) {
        while (this.solving) await new Promise((r) => setTimeout(r, 5)); // let the last pinned position finish first
        await this.resolve(); // settle without pinning the dragged point
      }
      this.render();
      return;
    }
    if (this.tool === "select") return;
    if (this.tool === "trim" || this.tool === "extend" || this.tool === "split") {
      const hit = this.pick(e);
      const uv = this.planeUV(e);
      const line = hit?.kind === "entity" ? this.s.entities.find((x) => x.id === hit.id) : undefined;
      if (line?.type === "line" && uv && !line.reference) {
        if (this.tool === "split") {
          const cut = E.splitLine(this.s, line.id, uv[0], uv[1]);
          if (cut) {
            this.pushUndo();
            this.s = cut.sketch;
            this.resolve();
          } else this.host.status("Click along the line, away from its ends, to cut it", true);
        } else {
          this.pushUndo();
          this.s = (this.tool === "trim" ? M.trimLine : M.extendLine)(this.s, line.id, uv[0], uv[1]);
          this.resolve();
        }
      }
      this.render();
      return;
    }
    const snap = this.snap(e);
    if (!snap) return;
    this.place(snap);
  }

  /** Add the next point of the shape being drawn, from a click or a typed size; finishes the shape when it has enough points. */
  private place(snap: Snap) {
    this.chain.push(snap);
    if (this.tool === "line") {
      if (this.chain.length >= 2) {
        const closed = this.addLine(this.chain[this.chain.length - 2], snap);
        if (closed) this.endChain();
        else this.chain = [snap];
      }
    } else if (this.tool === "spline") {
      const first = this.chain[0];
      if (this.chain.length >= 3 && snap.id !== undefined && snap.id === first.id) {
        this.chain.pop();
        this.addSpline(true);
        return;
      }
    } else if (this.tool === "ellipse" && this.chain.length === 3) {
      this.addEllipse(this.chain[0], this.chain[1], this.chain[2]);
      this.chain = [];
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
    } else if (this.tool === "arc3" && this.chain.length === 3) {
      this.addArcThrough(this.chain[0], this.chain[1], this.chain[2]);
      this.chain = [];
    } else if (this.tool === "circle3" && this.chain.length === 3) {
      this.addCircleThrough(this.chain[0], this.chain[1], this.chain[2]);
      this.chain = [];
    } else if (this.tool === "slot" && this.chain.length === 3) {
      this.addSlot(this.chain[0], this.chain[1], this.chain[2]);
      this.chain = [];
    } else if (this.tool === "point") {
      this.pushUndo();
      this.pointFor(snap);
      this.chain = [];
      this.resolve();
    }
    this.cursor = null;
    this.render();
  }

  /** Drawing tools whose size can be typed: the digits go to the next point's distance, Enter places it. */
  private typable(): boolean {
    return this.active && this.chain.length > 0 && (["line", "circle", "rectangle", "rectcentre"].includes(this.tool) || !!POLYGON_SIDES[this.tool]);
  }

  /** Digits typed while drawing (captured before the key router sees them). Enter applies, Backspace edits, Escape clears. */
  private onTyping = (e: KeyboardEvent) => {
    if (!this.typable() || e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).closest("input, select, textarea")) return;
    const rect = this.tool === "rectangle" || this.tool === "rectcentre";
    if (/^[0-9]$/.test(e.key) || e.key === "." || e.key === ",") this.typed += e.key === "," ? "." : e.key;
    else if (e.key === " " && rect && this.typed && !this.typed.includes(" ")) this.typed += " ";
    else if (e.key === "Backspace" && this.typed) this.typed = this.typed.slice(0, -1);
    else if (e.key === "Escape" && this.typed) this.typed = "";
    else if (e.key === "Enter" && this.typed) void this.applyTyped();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (this.typed) this.host.status(rect ? `Typed size: ${this.typed}| (width, space, height; Enter places it)` : `Typed size: ${this.typed}| (Enter places it)`);
    this.render();
  };
  private typed = "";

  /** Place the next point at the typed distance in the pointer's direction and keep the typed size as a dimension. */
  private async applyTyped() {
    const numbers = this.typed.trim().split(/\s+/).map(Number);
    this.typed = "";
    if (numbers.some((n) => !Number.isFinite(n) || n <= 0)) return this.host.status("That is not a positive size", true);
    const last = this.chain[this.chain.length - 1];
    const first = this.chain[0];
    const toward = this.cursor ?? { u: last.u + 1, v: last.v };
    const [du, dv] = [toward.u - last.u, toward.v - last.v];
    const length = Math.hypot(du, dv) || 1;
    const before = this.s.entities.length;
    let dimensions: Omit<M.SketchConstraint, "id">[] = [];
    let target: { u: number; v: number };
    const [w, h] = [numbers[0], numbers[1] ?? numbers[0]];
    if (this.tool === "rectangle" || this.tool === "rectcentre") {
      const k = this.tool === "rectcentre" ? 2 : 1;
      target = { u: first.u + (toward.u - first.u < 0 ? -w : w) / k, v: first.v + (toward.v - first.v < 0 ? -h : h) / k };
    } else {
      target = { u: last.u + (du / length) * w, v: last.v + (dv / length) * w };
    }
    this.place({ ...target });
    const made = this.s.entities.slice(before);
    const plain = !made.some((x) => x.type === "arc"); // a rounded rectangle's sides are not its overall size
    if (this.tool === "line" && made[0]?.type === "line") dimensions = [{ type: "distance", entity: made[0].id, value: w }];
    else if (this.tool === "circle" && made[0]?.type === "circle") dimensions = [{ type: "radius", entity: made[0].id, value: w }];
    else if ((this.tool === "rectangle" || this.tool === "rectcentre") && plain && made.length >= 2) {
      dimensions = [{ type: "distance", entity: made[0].id, value: w }, { type: "distance", entity: made[1].id, value: h }];
    }
    for (const d of dimensions) {
      this.s.constraints.push({ id: M.nextId(this.s), ...d });
      if (!(await this.resolve())) {
        this.s.constraints.pop(); // the typed size clashes with what the shape is tied to: keep the shape, drop the dimension
        await this.resolve();
        this.host.status("The typed size conflicts with existing constraints, so only the shape was placed", true);
      }
    }
    this.render();
  }

  private endChain() {
    this.typed = "";
    if (this.tool === "spline" && this.chain.length >= 2) this.addSpline(false);
    this.chain = [];
    this.chainStart = undefined;
    this.cursor = null;
    this.render();
  }

  onKey(e: KeyboardEvent) {
    if (!this.active || this.settingsDialog?.open) return;
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
    if (snap.on) this.addConstraintRaw(snap.on.midpoint ? { type: "midpoint", point: id, entity: snap.on.entity } : { type: "point_on", point: id, entity: snap.on.entity }, "snap");
    return id;
  }

  /** A constraint a drawing tool adds on its own: "snap" ones follow from where you clicked, "shape" ones keep a rectangle, polygon or slot its shape. Whether either is added is the sketch option `auto`. */
  private addConstraintRaw(c: Omit<M.SketchConstraint, "id">, kind: "snap" | "shape" = "shape") {
    if (this.options.auto === "none" || (this.options.auto === "snaps" && kind === "shape")) return;
    this.s.constraints.push({ id: M.nextId(this.s), ...c, auto: true }); // every caller is a drawing tool, not the user
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
    if (b.tangent !== undefined) this.addConstraintRaw({ type: "tangent", entities: [id, b.tangent] }, "snap");
    if (b.axis === "h") this.addConstraintRaw({ type: "horizontal", entity: id }, "snap");
    if (b.axis === "v") this.addConstraintRaw({ type: "vertical", entity: id }, "snap");
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
    const id = M.nextId(this.s);
    this.s.entities.push({ id, type: "circle", center: c, radius });
    if (edge.tangent !== undefined) this.addConstraintRaw({ type: "tangent", entities: [id, edge.tangent] }, "snap");
    this.resolve();
  }

  private addEllipse(center: Snap, major: Snap, side: Snap) {
    const a = Math.hypot(major.u - center.u, major.v - center.v);
    if (a < 1e-6) return;
    // the short radius is how far the third click is from the long axis
    const minor = Math.abs(((side.u - center.u) * (major.v - center.v) - (side.v - center.v) * (major.u - center.u)) / a);
    if (minor < 1e-6) return;
    this.pushUndo();
    const c = this.pointFor(center);
    const m = this.pointFor(major);
    this.s.entities.push({ id: M.nextId(this.s), type: "ellipse", center: c, major: m, minor });
    this.resolve();
  }

  /** The clicked points become a spline through them; a closed one joins the last back to the first. */
  private addSpline(closed: boolean) {
    this.pushUndo();
    const ids: number[] = [];
    for (const snap of this.chain) {
      const id = this.pointFor(snap);
      if (ids[ids.length - 1] !== id) ids.push(id);
    }
    if (ids.length < 2) return;
    this.s.entities.push({ id: M.nextId(this.s), type: "spline", points: ids, ...(closed && ids.length > 2 ? { closed: true } : {}) });
    this.chain = [];
    this.resolve();
  }

  private addArcThrough(start: Snap, through: Snap, end: Snap) {
    const arc = Sh.arcThrough(start, through, end);
    if (!arc) return this.host.status("Those three points are in a line, so no arc passes through them", true);
    this.pushUndo();
    const [first, last] = arc.from === "start" ? [start, end] : [end, start];
    const centre = this.pointFor({ u: arc.centre.u, v: arc.centre.v } as Snap);
    const a = this.pointFor(first);
    const b = this.pointFor(last);
    this.s.entities.push({ id: M.nextId(this.s), type: "arc", center: centre, start: a, end: b });
    this.resolve();
  }

  private addCircleThrough(a: Snap, b: Snap, c: Snap) {
    const circle = Sh.circumcircle(a, b, c);
    if (!circle) return this.host.status("Those three points are in a line, so no circle passes through them", true);
    this.pushUndo();
    const centre = this.pointFor({ u: circle.u, v: circle.v } as Snap);
    const id = M.nextId(this.s);
    this.s.entities.push({ id, type: "circle", center: centre, radius: circle.radius });
    for (const snap of [a, b, c]) if (snap.id !== undefined) this.addConstraintRaw({ type: "point_on", point: snap.id, entity: id }, "snap"); // existing points stay on it
    this.resolve();
  }

  /** Two end centres and a width: two straight edges and two half-circle ends that stay tangent and equal. */
  private addSlot(a: Snap, b: Snap, side: Snap) {
    const corners = Sh.slotCorners(a, b, Sh.distanceToAxis(a, b, side));
    if (!corners) return;
    this.pushUndo();
    const [ca, cb] = [this.pointFor(a), this.pointFor(b)];
    const at = (p: Sh.UV) => this.pointFor({ u: p.u, v: p.v } as Snap);
    const [aLeft, aRight, bLeft, bRight] = [corners.aLeft, corners.aRight, corners.bLeft, corners.bRight].map(at);
    const top = this.addLineBetween(aLeft, bLeft);
    const bottom = this.addLineBetween(bRight, aRight);
    // Both ends run counterclockwise: the far end from its right corner to its left, the near end back round.
    const endB = M.nextId(this.s);
    this.s.entities.push({ id: endB, type: "arc", center: cb, start: bRight, end: bLeft });
    const endA = M.nextId(this.s);
    this.s.entities.push({ id: endA, type: "arc", center: ca, start: aLeft, end: aRight });
    for (const [arc, line] of [[endB, top], [endB, bottom], [endA, top], [endA, bottom]]) this.addConstraintRaw({ type: "tangent", entities: [arc, line] });
    this.addConstraintRaw({ type: "equal", entities: [endA, endB] });
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
    const arcId = M.nextId(this.s);
    this.s.entities.push({ id: arcId, type: "arc", center: c, start: s, end: e });
    // An arc that starts on the end of a line, with its centre square to the line there, continues it tangentially.
    const meets = this.s.entities.find((x) => x.type === "line" && !x.reference && (x.a === s || x.b === s));
    if (meets && meets.type === "line") {
      const other = M.pointOf(this.s, meets.a === s ? meets.b : meets.a);
      const at = M.pointOf(this.s, s);
      const [lu, lv] = [at.u - other.u, at.v - other.v];
      const [cu, cv] = [center.u - at.u, center.v - at.v];
      const cosine = Math.abs(lu * cu + lv * cv) / (Math.hypot(lu, lv) * Math.hypot(cu, cv) || 1);
      if (cosine < Math.sin((AUTO_AXIS_DEG * 2 * Math.PI) / 180)) this.addConstraintRaw({ type: "tangent", entities: [arcId, meets.id] }, "snap");
    }
    this.resolve();
  }

  private setTool(tool: Tool) {
    if (tool !== "select") usage.record(`sketch_${tool}`.toLowerCase().replace(/[^a-z0-9_]/g, "_"), "start", "other");
    this.tool = tool;
    this.typed = "";
    this.chain = [];
    this.chainStart = undefined;
    this.cursor = null;
    this.hover = null;
    this.onToolChange?.();
    this.host.status(`Sketch ${SKETCH_TOOLS.find((t) => t.id === tool)!.label}: ${SKETCH_TOOLS.find((t) => t.id === tool)!.hint}`);
    this.render();
  }

  private async applyConstraint(option: M.ConstraintOption) {
    const built = option.build(this.s, this.selection);
    if (!built) return;
    if (option.dimension) {
      const answer = await this.askNumber(option.label, option.initial!(this.s, this.selection));
      if (answer === null) return;
      built.value = answer.value;
      if (answer.reference) built.reference = true;
    }
    this.pushUndo();
    const before = JSON.stringify(this.s);
    const added = { id: M.nextId(this.s), ...built };
    this.s.constraints.push(added);
    const ok = await this.resolve();
    if (!ok) {
      const clash = this.s.constraints.filter((c) => this.failed.has(c.id) && c.id !== added.id).map((c) => M.describeConstraint(this.s, c));
      this.s = JSON.parse(before);
      this.undoStack.pop();
      await this.resolve();
      this.host.status(`That constraint conflicts with ${clash.length ? clash.join("; ") : "the existing ones"} (or is redundant), so it was not added`, true);
    }
    this.render();
  }

  /** The sketch settings window (the gear in the sketch card): grid spacing and automatic constraints. Changes apply at once and are remembered on this computer. */
  private openSettings() {
    if (this.settingsDialog?.open) return;
    const dialog = document.createElement("dialog");
    dialog.className = "sketchsettings";
    dialog.addEventListener("keydown", (e) => e.stopPropagation()); // typing here is not a sketch shortcut
    const row = (label: string, input: HTMLElement, unit = "") => {
      const r = document.createElement("label");
      const text = document.createElement("span");
      text.textContent = label;
      const tail = document.createElement("span");
      tail.className = "unit";
      tail.textContent = unit;
      r.append(text, input, tail);
      return r;
    };
    const spacing = (value: number, min: number, on: (n: number) => void) => {
      const input = document.createElement("input");
      input.type = "number";
      input.min = String(min);
      input.step = "any";
      input.value = String(value);
      input.addEventListener("change", () => {
        const n = Number(input.value);
        if (Number.isFinite(n) && n >= min) on(n);
        input.value = String(n >= min ? n : value);
        this.saveOptions();
        this.buildGrid();
      });
      return input;
    };
    const auto = document.createElement("select");
    for (const [value, label] of [["none", "Off: geometry stays free"], ["snaps", "From snaps only"], ["shape", "Snaps and shapes"]]) auto.append(new Option(label, value, false, value === this.options.auto));
    auto.title = "Off: drawing tools never add constraints, so everything moves freely until you constrain it. From snaps: a line snapped to horizontal or vertical, or a point snapped onto a curve, keeps that. Snaps and shapes: also keeps rectangles, polygons and slots in shape";
    auto.addEventListener("change", () => {
      this.options.auto = auto.value as SketchOptions["auto"];
      this.saveOptions();
    });
    const title = document.createElement("h3");
    title.textContent = "Sketch settings";
    const grid = document.createElement("div");
    grid.className = "group";
    grid.textContent = "Grid (shown with the grid button in the sketch card)";
    const done = document.createElement("button");
    done.textContent = "Done";
    done.addEventListener("click", () => dialog.close());
    dialog.append(
      title,
      grid,
      row("Major spacing", spacing(this.options.major, 0.001, (n) => (this.options.major = n)), LENGTH_UNIT),
      row("Minor spacing", spacing(this.options.minor, 0, (n) => (this.options.minor = n)), `${LENGTH_UNIT} (0 for none)`),
      Object.assign(document.createElement("div"), { className: "group", textContent: "Drawing" }),
      row("Automatic constraints", auto),
      done,
    );
    dialog.addEventListener("close", () => {
      dialog.remove();
      this.settingsDialog = null;
    });
    document.body.append(dialog);
    this.settingsDialog = dialog;
    dialog.showModal();
  }

  /** Change the value of an existing dimension; a value the other constraints refuse is undone. */
  private async editDimension(id: number) {
    const c = this.s.constraints.find((x) => x.id === id);
    if (!c || c.value === undefined) return;
    const answer = await this.askNumber(M.describeConstraint(this.s, c).replace(/ = .*$/, ""), c.value);
    if (answer === null || answer.reference) return;
    await this.changeConstraints((cs) => cs.map((x) => (x.id === id ? { ...x, value: answer.value } : x)), "That value conflicts with other constraints, so it was not changed");
  }

  /** Switch a dimension between driving the shape and only measuring it; a driving one starts from the current measurement. */
  private async toggleReference(id: number) {
    await this.changeConstraints((cs) =>
      cs.map((x) => {
        if (x.id !== id) return x;
        if (x.reference) {
          const { reference: _unused, ...rest } = x;
          return { ...rest, value: M.measure(this.s, x) ?? x.value };
        }
        return { ...x, reference: true, value: M.measure(this.s, x) ?? x.value };
      }),
      "Making that dimension drive the shape conflicts with other constraints, so it stays a reference",
    );
  }

  private async changeConstraints(change: (cs: M.SketchConstraint[]) => M.SketchConstraint[], failure: string) {
    this.pushUndo();
    const before = JSON.stringify(this.s);
    this.s.constraints = change(this.s.constraints);
    if (!(await this.resolve())) {
      this.s = JSON.parse(before);
      this.undoStack.pop();
      await this.resolve();
      this.host.status(failure, true);
    }
    this.render();
  }

  /** Ask for a dimension's value; ticking "Reference" keeps the current measurement instead of driving the shape. */
  /** Several numbers at once (and optionally a Copy box) in the ask strip. Resolves null when cancelled. */
  private askForm(title: string, fields: { label: string; value: number; integer?: boolean }[], copy?: boolean): Promise<{ values: number[]; copy: boolean } | null> {
    return new Promise((resolve) => {
      const box = this.panel.querySelector<HTMLElement>(".ask")!;
      box.hidden = false;
      box.replaceChildren();
      const inputs = fields.map((f) => {
        const input = document.createElement("input");
        input.type = "number";
        input.step = f.integer ? "1" : "any";
        input.value = String(parseFloat(f.value.toFixed(3)));
        input.title = f.label;
        input.addEventListener("keydown", (e) => {
          e.stopPropagation();
          if (e.key === "Enter") ok.click();
          else if (e.key === "Escape") done(null);
        });
        return input;
      });
      const copyBox = document.createElement("input");
      copyBox.type = "checkbox";
      copyBox.checked = copy ?? false;
      const done = (values: number[] | null) => {
        box.hidden = true;
        box.replaceChildren();
        resolve(values ? { values, copy: copyBox.checked } : null);
      };
      const ok = document.createElement("button");
      ok.textContent = "OK";
      ok.addEventListener("click", () => {
        const values = inputs.map((i) => Number(i.value));
        done(values.every(Number.isFinite) ? values : null);
      });
      const cancel = document.createElement("button");
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => done(null));
      const rows = fields.map((f, k) => {
        const label = document.createElement("label");
        label.append(`${f.label} `, inputs[k]);
        return label;
      });
      const copyLabel = document.createElement("label");
      copyLabel.append(copyBox, " Copy");
      box.append(title, ...rows, ...(copy === undefined ? [] : [copyLabel]), ok, cancel);
      inputs[0]?.focus();
      inputs[0]?.select();
    });
  }

  /** Replace the sketch with an edited one (move, copy, array) and settle it; a result the constraints refuse is undone. */
  private async applyEdit(make: () => E.EditResult) {
    this.pushUndo();
    const before = JSON.stringify(this.s);
    const made = make();
    this.s = made.sketch;
    this.selection = made.selection;
    const ok = await this.resolve();
    if (!ok) {
      this.s = JSON.parse(before);
      this.undoStack.pop();
      this.selection = [];
      await this.resolve();
      this.host.status("The constraints do not allow that change, so it was not made", true);
    }
    this.render();
  }

  private transformButtons(): HTMLElement | null {
    if (!E.selected(this.s, this.selection).points.length) return null;
    const [cu, cv] = E.centroid(this.s, this.selection);
    const sel = [...this.selection];
    const row = document.createElement("div");
    row.className = "row-buttons";
    const add = (label: string, tip: string, run: () => Promise<void> | void) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.title = tip;
      b.addEventListener("click", () => void run());
      row.append(b);
    };
    add("Move…", "Move the selection by a distance along the sketch axes, or copy it there", async () => {
      const a = await this.askForm("Move", [{ label: "Across", value: 0 }, { label: "Up", value: 0 }], false);
      if (a) await this.applyEdit(() => E.transform(this.s, sel, E.translation(a.values[0], a.values[1]), { copy: a.copy }));
    });
    add("Rotate…", "Rotate the selection by an angle about a point (starts at its middle)", async () => {
      const a = await this.askForm("Rotate", [{ label: "Degrees", value: 90 }, { label: "About across", value: cu }, { label: "About up", value: cv }], false);
      if (a) await this.applyEdit(() => E.transform(this.s, sel, E.rotation(a.values[0], a.values[1], a.values[2]), { copy: a.copy }));
    });
    add("Scale…", "Scale the selection about a point (starts at its middle)", async () => {
      const a = await this.askForm("Scale", [{ label: "Factor", value: 2 }, { label: "About across", value: cu }, { label: "About up", value: cv }], false);
      if (a && a.values[0] > 0) await this.applyEdit(() => E.transform(this.s, sel, E.scaling(a.values[0], a.values[1], a.values[2]), { copy: a.copy, scale: a.values[0] }));
    });
    const lines = sel.filter((x) => x.kind === "entity" && this.s.entities.find((e) => e.id === x.id)?.type === "line");
    const rest = sel.filter((x) => !lines.length || x !== lines[lines.length - 1]);
    if (lines.length && E.selected(this.s, rest).points.length) {
      const axis = lines[lines.length - 1].id;
      add("Mirror", "Add a mirror image of the selection across the last line you selected, kept symmetric by constraints", () => {
        const l = this.s.entities.find((e) => e.id === axis) as Extract<M.SketchEntity, { type: "line" }>;
        const [a, b] = [M.pointOf(this.s, l.a), M.pointOf(this.s, l.b)];
        return this.applyEdit(() => E.transform(this.s, rest, E.reflection(a.u, a.v, b.u - a.u, b.v - a.v), { copy: true, mirror: true, axis }));
      });
    }
    add("Mirror in horizontal axis", "Add a mirror image across the horizontal axis of the sketch", () =>
      this.applyEdit(() => E.transform(this.s, sel, E.reflection(0, 0, 1, 0), { copy: true, mirror: true })));
    add("Mirror in vertical axis", "Add a mirror image across the vertical axis of the sketch", () =>
      this.applyEdit(() => E.transform(this.s, sel, E.reflection(0, 0, 0, 1), { copy: true, mirror: true })));
    add("Row of copies…", "Repeat the selection in a row", async () => {
      const a = await this.askForm("Row", [{ label: "Count", value: 3, integer: true }, { label: "Step across", value: 10 }, { label: "Step up", value: 0 }]);
      if (a && a.values[0] >= 2 && a.values[0] <= 200) await this.applyEdit(() => E.repeat(this.s, sel, Math.round(a.values[0]), (k) => ({ map: E.translation(k * a.values[1], k * a.values[2]) })));
    });
    add("Circle of copies…", "Repeat the selection around a centre", async () => {
      const a = await this.askForm("Around", [{ label: "Count", value: 6, integer: true }, { label: "Total degrees", value: 360 }, { label: "Centre across", value: cu }, { label: "Centre up", value: cv }]);
      if (!a || a.values[0] < 2 || a.values[0] > 200) return;
      const count = Math.round(a.values[0]);
      const full = Math.abs(a.values[1]) >= 360;
      const step = a.values[1] / (full ? count : count - 1);
      await this.applyEdit(() => E.repeat(this.s, sel, count, (k) => ({ map: E.rotation(k * step, a.values[2], a.values[3]) })));
    });
    return row;
  }

  private askNumber(label: string, initial: number): Promise<{ value: number; reference: boolean } | null> {
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
      const reference = document.createElement("input");
      reference.type = "checkbox";
      reference.title = "Only show this measurement; it does not change the shape";
      const referenceLabel = document.createElement("label");
      referenceLabel.append(reference, " Reference");
      const done = (value: number | null) => {
        box.hidden = true;
        box.replaceChildren();
        resolve(value === null ? null : { value: reference.checked ? initial : value, reference: reference.checked });
      };
      const ok = document.createElement("button");
      ok.textContent = "OK";
      ok.title = "Accept this value";
      ok.addEventListener("click", () => done(Number.isFinite(Number(input.value)) ? Number(input.value) : null));
      const cancel = document.createElement("button");
      cancel.textContent = "Cancel";
      cancel.title = "Leave the value unchanged";
      cancel.addEventListener("click", () => done(null));
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") ok.click();
        else if (e.key === "Escape") done(null);
      });
      box.append(text, input, referenceLabel, ok, cancel);
      input.focus();
      input.select();
    });
  }

  // Solving -----------------------------------------------------------------------------------------

  /** Solve the constraints (latest request wins while one is in flight). Resolves true if the solver succeeded. */
  private resolve(drag?: Drag): Promise<boolean> {
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
          reply = await this.core.request<SolveReply>("sketch_solve", { sketch: this.s, drag: job.drag, detail: !job.drag });
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
          for (const e of this.s.entities) {
            if (e.type === "circle" && String(e.id) in reply.radii) e.radius = reply.radii[String(e.id)];
            if (e.type === "ellipse" && String(e.id) in reply.radii) e.minor = reply.radii[String(e.id)];
          }
          this.dof = reply.dof;
          this.failed.clear();
          if (reply.freedom) this.freedom = new Map(Object.entries(reply.freedom).map(([id, n]) => [Number(id), n]));
          ok = true;
        } else if (!job.drag) {
          this.failed = new Set([...reply.failed, ...(reply.conflicts ?? [])].filter((x): x is number => x !== null));
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
        usage.record(this.extrude.revolve ? "sketch_revolve" : "sketch_extrude", "commit");
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

  /** Add parallel copies of the selected curves, `offset.distance` away (positive grows a closed outline). */
  private async offsetSelection() {
    const ids = this.selection.filter((x) => x.kind === "entity").map((x) => x.id);
    try {
      const made = await this.core.request<{ points: M.SketchPoint[]; entities: M.SketchEntity[] }>("sketch_offset", { sketch: this.s, entities: ids, distance: this.offset.distance });
      this.pushUndo();
      this.s.points.push(...made.points);
      this.s.entities.push(...made.entities);
      this.selection = made.entities.map((e) => ({ kind: "entity" as const, id: e.id }));
      this.resolve();
      this.render();
      this.host.status(`Offset ${made.entities.length} curve${made.entities.length === 1 ? "" : "s"} by ${this.offset.distance}`);
    } catch (e) {
      this.host.status((e as Error).message, true);
    }
  }
  private offset = { distance: 5 };

  /** Flatten the model's edges onto the sketch plane as fixed reference geometry the sketch can snap to. */
  private async projectModel() {
    try {
      const ref = await this.core.request<{ points: M.SketchPoint[]; entities: M.SketchEntity[]; skipped?: { square: number; tilted_circles: number; other: number } }>("sketch_project", { plane: this.s.plane });
      const near = (a: M.SketchPoint, b: M.SketchPoint) => Math.hypot(a.u - b.u, a.v - b.v) < 1e-5;
      const known = this.s.points.filter((p) => p.fixed);
      const entityKey = (e: M.SketchEntity) => JSON.stringify([e.type, ...M.entityPoints(e).map((id) => this.s.points.find((p) => p.id === id)).map((p) => p && [Math.round(p.u * 1e4), Math.round(p.v * 1e4)])]);
      const have = new Set(this.s.entities.filter((e) => e.reference).map(entityKey));
      this.pushUndo();
      const map = new Map<number, number>();
      for (const p of ref.points) {
        const twin = known.find((k) => near(k, p));
        if (twin) map.set(p.id, twin.id);
        else {
          const id = M.nextId(this.s);
          this.s.points.push({ ...p, id });
          map.set(p.id, id);
        }
      }
      let added = 0;
      for (const e of ref.entities) {
        const mapped = { ...e, id: M.nextId(this.s) } as M.SketchEntity;
        if (mapped.type === "line") (mapped.a = map.get(mapped.a)!), (mapped.b = map.get(mapped.b)!);
        else if (mapped.type === "circle") mapped.center = map.get(mapped.center)!;
        else if (mapped.type === "ellipse") (mapped.center = map.get(mapped.center)!), (mapped.major = map.get(mapped.major)!);
        else if (mapped.type === "spline") mapped.points = mapped.points.map((q) => map.get(q)!);
        else (mapped.center = map.get(mapped.center)!), (mapped.start = map.get(mapped.start)!), (mapped.end = map.get(mapped.end)!);
        if (have.has(entityKey(mapped))) continue;
        this.s.entities.push(mapped);
        added++;
      }
      this.resolve();
      this.render();
      const sk = ref.skipped;
      const notes = [
        sk?.tilted_circles ? `${sk.tilted_circles} tilted circle${sk.tilted_circles === 1 ? "" : "s"} (would be ellipses) not drawn, their end points are snappable` : "",
        sk?.other ? `${sk.other} curved edge${sk.other === 1 ? "" : "s"} of another kind skipped, their end points are snappable` : "",
        sk?.square ? `${sk.square} edge${sk.square === 1 ? "" : "s"} seen end-on shown as points` : "",
      ].filter(Boolean);
      this.host.status(`${added ? `Projected ${added} model edge${added === 1 ? "" : "s"}` : "No new model edges to project"}${notes.length ? `. ${notes.join("; ")}` : ""}`, !!(sk?.tilted_circles || sk?.other));
    } catch (e) {
      this.host.status((e as Error).message, true);
    }
  }

  /** Round or bevel the selected corner (a point where two lines meet) with the rectangle corner size. */
  private roundSelectedCorner(kind: "fillet" | "chamfer") {
    const point = this.selection.find((x) => x.kind === "point");
    if (!point) return this.host.status("Select the corner point first", true);
    const made = M.roundCorner(this.s, point.id, kind, this.rectOptions.size);
    if (typeof made === "string") return this.host.status(made, true);
    this.pushUndo();
    this.s = made;
    this.selection = [];
    this.resolve();
    this.render();
    this.host.status(kind === "fillet" ? "Rounded the corner" : "Bevelled the corner");
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
    for (const l of [this.axes, this.normal, this.placed, this.construction, this.marked, this.pending]) l.material.resolution.set(size.x, size.y);
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

  private lightUp(c: M.SketchConstraint | null) {
    const ids = c ? [...(c.entities ?? []), ...(c.entity !== undefined ? [c.entity] : [])] : [];
    const points = c ? [...(c.points ?? []), ...(c.point !== undefined ? [c.point] : [])] : [];
    this.highlight = [...points.map((id) => ({ kind: "point" as const, id })), ...ids.map((id) => ({ kind: "entity" as const, id }))];
    this.render(false); // keep the panel: rebuilding it under the pointer would end the hover
  }

  private isMarked(sel: M.SketchSel) {
    const same = (s: M.SketchSel) => s.kind === sel.kind && s.id === sel.id;
    return this.selection.some(same) || this.highlight.some(same) || (this.hover?.kind === sel.kind && this.hover.id === sel.id);
  }

  /** Whether the constraints already place every point of the entity (drawn green, like a fully constrained shape). */
  private isPlaced(e: M.SketchEntity): boolean {
    if (!this.freedom.size || this.failed.size) return false;
    const ids = M.entityPoints(e);
    return ids.length > 0 && ids.every((id) => this.freedom.get(id) === 0);
  }

  private render(panel = true) {
    if (!this.active) return;
    const normal: [number, number][][] = [];
    const marked: [number, number][][] = [];
    const guides: [number, number][][] = [];
    const placed: [number, number][][] = [];
    for (const e of this.s.entities) (this.isMarked({ kind: "entity", id: e.id }) ? marked : e.construction ? guides : this.isPlaced(e) ? placed : normal).push(M.polyline(this.s, e));
    this.drawAxes();
    this.set(this.normal, this.segments(normal));
    this.set(this.construction, this.segments(guides));
    this.set(this.marked, this.segments(marked));
    this.set(this.placed, this.segments(placed));
    this.set(this.pending, this.segments(this.pendingShapes()));

    const positions: number[] = [];
    const colors: number[] = [];
    const color = new THREE.Color();
    for (const p of this.s.points) {
      positions.push(...this.world(p.u, p.v).toArray());
      color.set(this.isMarked({ kind: "point", id: p.id }) ? COLORS.selected : this.cursor?.id === p.id ? COLORS.hover : p.fixed ? COLORS.construction : this.freedom.get(p.id) === 0 ? COLORS.placed : COLORS.line);
      colors.push(color.r, color.g, color.b);
    }
    this.points.geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    this.points.geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    this.points.geometry.computeBoundingSphere();
    this.overlay.set([...M.dimensionsOf(this.s), ...(this.showMarks ? M.constraintMarks(this.s) : []), ...this.liveDimensions()]);
    if (panel) this.renderPanel();
  }

  private drawAxes() {
    const reach = 400;
    const positions: number[] = [];
    const colors: number[] = [];
    for (const a of M.sketchAxes(this.s.plane)) {
      positions.push(...this.world(a.u - a.du * reach, a.v - a.dv * reach).toArray(), ...this.world(a.u + a.du * reach, a.v + a.dv * reach).toArray());
      const c = new THREE.Color([0xd9534f, 0x5cb85c, 0x4a90e2][a.axis]);
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    this.axes.visible = positions.length > 0;
    if (!positions.length) return;
    this.axes.geometry.dispose();
    this.axes.geometry = new LineSegmentsGeometry().setPositions(positions).setColors(colors);
  }

  private set(line: LineSegments2, positions: number[]) {
    line.visible = positions.length > 0;
    if (!positions.length) return;
    // A fresh geometry each time: reusing one whose segment count grows left it drawing only the first segments.
    line.geometry.dispose();
    line.geometry = new LineSegmentsGeometry().setPositions(positions);
  }

  /** Size tags next to the cursor while a shape is being placed: length and angle, width by height, or radius. */
  private liveDimensions(): Dimension[] {
    const c = this.cursor;
    const a = this.chain[this.chain.length - 1];
    if (!c || !a) return [];
    const n = (x: number) => parseFloat(x.toFixed(2)).toString();
    const tag = (u: number, v: number, text: string): Dimension[] => [{ kind: "tag", text, points: [M.toWorld(this.s.plane, u, v)] }];
    const du = c.u - a.u;
    const dv = c.v - a.v;
    if (this.typed) return tag((a.u + c.u) / 2, (a.v + c.v) / 2, `${this.typed}|`);
    if (this.tool === "line") return tag((a.u + c.u) / 2, (a.v + c.v) / 2, `${n(Math.hypot(du, dv))} at ${n((Math.atan2(dv, du) * 180) / Math.PI)}°`);
    if (this.tool === "rectangle") return tag((a.u + c.u) / 2, c.v, `${n(Math.abs(du))} × ${n(Math.abs(dv))}`);
    if (this.tool === "rectcentre") return tag(a.u, c.v, `${n(Math.abs(du) * 2)} × ${n(Math.abs(dv) * 2)}`);
    if (this.tool === "circle" || POLYGON_SIDES[this.tool]) return tag((a.u + c.u) / 2, (a.v + c.v) / 2, `R${n(Math.hypot(du, dv))}`);
    return [];
  }

  /** Rubber-band shapes for the drawing in progress. */
  private pendingShapes(): [number, number][][] {
    return [...this.pendingBase(), ...(this.cursor?.guides ?? [])];
  }
  private pendingBase(): [number, number][][] {
    const c = this.cursor;
    const first = this.chain[0];
    if (!c || !first) return c?.guides ?? [];
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
    if (this.tool === "spline") {
      const through = [...this.chain, c];
      const probe: M.SketchData = { ...this.s, points: through.map((q, i) => ({ id: -1 - i, u: q.u, v: q.v })) };
      return [M.polyline(probe, { id: 0, type: "spline", points: through.map((_, i) => -1 - i) }, 48)];
    }
    if (this.tool === "ellipse") {
      const probe: M.SketchData = { ...this.s, points: [{ id: -1, u: first.u, v: first.v }, { id: -2, u: (this.chain[1] ?? c).u, v: (this.chain[1] ?? c).v }] };
      const a = Math.hypot(probe.points[1].u - first.u, probe.points[1].v - first.v);
      if (!this.chain[1] || a < 1e-9) return [[[first.u, first.v], [c.u, c.v]]];
      const minor = Math.abs(((c.u - first.u) * (probe.points[1].v - first.v) - (c.v - first.v) * (probe.points[1].u - first.u)) / a);
      return [M.polyline(probe, { id: 0, type: "ellipse", center: -1, major: -2, minor: Math.max(minor, 1e-6) }, 48)];
    }
    const second = this.chain[1];
    if (this.tool === "slot") {
      if (!second) return [[[first.u, first.v], [c.u, c.v]]];
      const corners = Sh.slotCorners(first, second, Sh.distanceToAxis(first, second, c));
      if (!corners) return [[[first.u, first.v], [second.u, second.v]]];
      const ring = (centre: Sh.UV, from: Sh.UV, to: Sh.UV): [number, number][] => {
        const [a0, a1] = [Math.atan2(from.v - centre.v, from.u - centre.u), Math.atan2(to.v - centre.v, to.u - centre.u)];
        const sweep = (a1 - a0 + 4 * Math.PI) % (2 * Math.PI);
        const radius = Math.hypot(from.u - centre.u, from.v - centre.v);
        return Array.from({ length: 25 }, (_, i) => [centre.u + radius * Math.cos(a0 + (sweep * i) / 24), centre.v + radius * Math.sin(a0 + (sweep * i) / 24)]);
      };
      return [[[corners.aLeft.u, corners.aLeft.v], [corners.bLeft.u, corners.bLeft.v]], [[corners.bRight.u, corners.bRight.v], [corners.aRight.u, corners.aRight.v]], ring(second, corners.bRight, corners.bLeft), ring(first, corners.aLeft, corners.aRight)];
    }
    if (this.tool === "circle3" || this.tool === "arc3") {
      if (!second) return [[[first.u, first.v], [c.u, c.v]]];
      const probe = Sh.circumcircle(first, second, c);
      if (!probe) return [[[first.u, first.v], [second.u, second.v], [c.u, c.v]]];
      if (this.tool === "circle3") return [Array.from({ length: 49 }, (_, i) => [probe.u + probe.radius * Math.cos((2 * Math.PI * i) / 48), probe.v + probe.radius * Math.sin((2 * Math.PI * i) / 48)] as [number, number])];
      const arc = Sh.arcThrough(first, second, c)!;
      const [from, to] = arc.from === "start" ? [first, c] : [c, first];
      const a0 = Math.atan2(from.v - probe.v, from.u - probe.u);
      const sweep = (Math.atan2(to.v - probe.v, to.u - probe.u) - a0 + 4 * Math.PI) % (2 * Math.PI);
      return [Array.from({ length: 49 }, (_, i) => [probe.u + probe.radius * Math.cos(a0 + (sweep * i) / 48), probe.v + probe.radius * Math.sin(a0 + (sweep * i) / 48)] as [number, number])];
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

    const iconButton = (icon: string, title: string, on: () => void, pressed = false) => {
      const b = document.createElement("button");
      b.className = "iconbtn" + (pressed ? " active" : "");
      b.title = title;
      b.append(uiIcon(icon));
      b.addEventListener("click", on);
      return b;
    };
    const header = el("div", "head");
    if (this.kept) header.title = `Editing ${this.kept.name}`;
    const grid = iconButton("grid", this.options.grid ? "Hide the grid" : "Show the grid (set its spacing in the sketch settings)", () => {
      this.options.grid = !this.options.grid;
      this.saveOptions();
      this.buildGrid();
      this.renderPanel();
    }, this.options.grid);
    const snap = iconButton("gridSnap", this.options.snapGrid ? "Snap to grid is on: click to turn it off" : "Snap to grid: drawn points land on the grid spacing", () => {
      this.options.snapGrid = !this.options.snapGrid;
      this.saveOptions();
      this.renderPanel();
    }, this.options.snapGrid);
    const look = iconButton("lookAt", "Turn the view square to the sketch plane (entering a sketch does not move the view)", () => this.viewport.lookFrom(new THREE.Vector3(...M.frame(this.s.plane).n)));
    const gear = iconButton("gear", "Sketch settings", () => this.openSettings());
    gear.style.marginLeft = "auto";
    header.append(el("span", "title", this.kept ? this.kept.name : "Sketch"), look, grid, snap, gear);
    const status = el("div", "dof", this.failed.size ? `Conflict: ${this.s.constraints.filter((c) => this.failed.has(c.id)).map((c) => M.describeConstraint(this.s, c)).join("; ") || [...this.failed].join(", ")}. Remove one (red rows below)` : this.dof === null ? "" : this.dof === 0 ? "Fully constrained" : `${this.dof} degrees of freedom left`);
    if (this.failed.size) status.classList.add("bad");

    const tools = el("div", "row-buttons"); // options of the drawing tool chosen in the top bar

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

    const transformRow = this.transformButtons();
    const transformBox = el("div", "section");
    if (transformRow) transformBox.append(el("div", "group", "Edit selection"), transformRow);
    const ask = el("div", "ask");
    ask.hidden = true;

    const list = el("div", "section");
    const autos = this.s.constraints.filter((c) => c.auto);
    list.append(el("div", "group", `Constraints (${this.s.constraints.length}${autos.length ? `, ${autos.length} automatic` : ""})`));
    const marks = button(this.showMarks ? "Hide marks" : "Show marks", () => {
      this.showMarks = !this.showMarks;
      this.render();
    });
    marks.title = "Show or hide the small tags (H, V, T, =, ...) that mark where constraints act";
    list.append(marks);
    const check = button("Check sketch", () => {
      this.selection = Chk.openEnds(this.s).map((id) => ({ kind: "point" as const, id }));
      this.host.status(Chk.describeProblems(this.s));
      this.render();
    });
    check.title = "Report points that nearly touch and line ends that meet nothing; the open ends are selected";
    const join = button("Join near points", async () => {
      const gaps = Chk.findGaps(this.s);
      if (!gaps.length) return this.host.status("No points nearly touch");
      this.pushUndo();
      this.s = Chk.joinGaps(this.s, gaps);
      this.selection = [];
      await this.resolve();
      this.host.status(`Joined ${gaps.length} pair${gaps.length === 1 ? "" : "s"} of points`);
      this.render();
    });
    join.title = "Merge points that are very close but not the same point, so outlines close";
    list.append(check, join);
    for (const c of this.s.constraints) {
      const row = el("div", this.failed.has(c.id) ? "crow bad" : "crow");
      row.append(el("span", "", M.describeConstraint(this.s, c) + (c.auto ? " (automatic)" : "")));
      row.title = c.auto ? "Added by a drawing tool. Hover to see what it holds; the x removes it so the geometry moves freely" : "Hover to see what it holds; the x removes it";
      row.addEventListener("pointerenter", () => this.lightUp(c));
      row.addEventListener("pointerleave", () => this.lightUp(null));
      if (c.value !== undefined) {
        const edit = button("✎", () => void this.editDimension(c.id));
        edit.title = c.reference ? "Make this a driving dimension again" : "Change the value";
        const ref = button(c.reference ? "Drive" : "Ref", () => void this.toggleReference(c.id));
        ref.title = c.reference ? "Make this dimension drive the shape" : "Keep only the measurement; the dimension stops driving the shape";
        row.append(...(c.reference ? [ref] : [edit, ref]));
      }
      const remove = button("✕", () => {
        this.pushUndo();
        this.s.constraints = this.s.constraints.filter((x) => x.id !== c.id);
        this.highlight = [];
        this.resolve();
        this.render();
      });
      remove.title = "Remove this constraint";
      row.append(remove);
      list.append(row);
    }
    if (autos.length) {
      const clear = button("Remove automatic constraints", () => {
        this.pushUndo();
        this.s.constraints = this.s.constraints.filter((x) => !x.auto);
        this.highlight = [];
        this.resolve();
        this.render();
      });
      clear.title = "Remove every constraint a drawing tool added (horizontal and vertical sides, snaps onto curves); constraints you added stay";
      list.append(clear);
    }

    const extrude = el("div", "section");
    const preview = (change: () => void) => {
      change();
      this.extrude.open = true;
      this.schedulePreview();
    };
    const tip = (b: HTMLElement, text: string) => ((b.title = text), b);
    const number = (value: number, on: (n: number) => void, tip = "") => {
      const input = document.createElement("input");
      input.title = tip;
      input.type = "number";
      input.step = "any";
      input.value = String(value);
      input.addEventListener("keydown", (e) => e.stopPropagation());
      input.addEventListener("input", () => preview(() => on(Number(input.value))));
      return input;
    };
    const mode = document.createElement("select");
    for (const m of ["join", "new", "cut"]) mode.append(new Option(m === "join" ? "Join (add material)" : m === "new" ? "New body" : "Cut (remove material)", m, false, m === this.extrude.mode));
    mode.title = "Add the new shape to the model, keep it as a separate body, or cut it out of the model";
    mode.addEventListener("change", () => preview(() => (this.extrude.mode = mode.value as "join" | "cut" | "new")));
    const symmetric = document.createElement("input");
    symmetric.type = "checkbox";
    symmetric.checked = this.extrude.symmetric;
    symmetric.title = "Extrude the same distance both ways from the sketch plane";
    symmetric.addEventListener("change", () => preview(() => (this.extrude.symmetric = symmetric.checked)));
    const symmetricLabel = el("label", "crow");
    symmetricLabel.append(el("span", "", "Both directions"), symmetric);

    extrude.append(el("div", "group", "Extrude profile"));
    const row = el("div", "crow");
    row.append(number(this.extrude.distance, (n) => ((this.extrude.distance = n), (this.extrude.revolve = false)), "Extrude distance"), mode);
    const go = el("div", "row-buttons");
    go.append(
      tip(button("Preview", () => {
        this.extrude.revolve = false;
        this.extrude.open = true;
        this.sendExtrude(false);
      }), "Show the result without changing the model"),
      tip(button("Extrude", () => {
        this.extrude.revolve = false;
        this.extrude.open = true;
        this.sendExtrude(true);
      }, "active"), "Extrude the sketch regions into the model"),
    );
    extrude.append(row, symmetricLabel, go);

    extrude.append(el("div", "group", "Revolve about the selected line"));
    const spin = el("div", "crow");
    spin.append(number(this.extrude.angle, (n) => ((this.extrude.angle = n), (this.extrude.revolve = true)), "Revolve angle in degrees"), el("span", "", "degrees"));
    const spinGo = el("div", "row-buttons");
    spinGo.append(
      tip(button("Preview", () => {
        this.extrude.revolve = true;
        this.extrude.open = true;
        this.sendExtrude(false);
      }), "Show the result without changing the model"),
      tip(button("Revolve", () => {
        this.extrude.revolve = true;
        this.extrude.open = true;
        this.sendExtrude(true);
      }, "active"), "Spin the sketch regions around the selected line into the model"),
    );
    extrude.append(spin, spinGo);

    if (this.selection.some((x) => x.kind === "point")) {
      const size = document.createElement("input");
      size.type = "number";
      size.step = "any";
      size.min = "0";
      size.value = String(this.rectOptions.size);
      size.title = "Corner radius or bevel size";
      size.addEventListener("keydown", (e) => e.stopPropagation());
      size.addEventListener("input", () => (this.rectOptions.size = Math.abs(Number(size.value)) || 0));
      const cornerRow = el("div", "row-buttons");
      cornerRow.append(button("Round corner", () => this.roundSelectedCorner("fillet")), button("Bevel corner", () => this.roundSelectedCorner("chamfer")), size);
      constraintsBox.append(cornerRow);
    }

    if (this.selection.some((x) => x.kind === "entity")) {
      const distance = document.createElement("input");
      distance.type = "number";
      distance.step = "any";
      distance.value = String(this.offset.distance);
      distance.title = "Offset distance (negative shrinks a closed outline)";
      distance.addEventListener("keydown", (e) => e.stopPropagation());
      distance.addEventListener("input", () => (this.offset.distance = Number(distance.value) || 0));
      const offsetRow = el("div", "row-buttons");
      offsetRow.append(button("Offset", () => this.offsetSelection()), distance);
      constraintsBox.append(offsetRow);
      const construction = button("Toggle construction", () => this.toggleConstruction());
      construction.title = "Construction geometry guides the sketch but is not part of the profile (use it as a revolve axis)";
      constraintsBox.append(construction);
    }

    const flat = this.unwrapFace === null;
    const project = button("Project model edges", () => this.projectModel());
    project.title = "Flatten the model's edges onto this plane as fixed geometry to snap and constrain to";
    if (flat) constraintsBox.append(project);

    const finish = button("Finish sketch", () => this.finish());
    finish.title = "Leave the sketch and keep it in the list of sketches; with Make faces ticked its closed regions also become faces you can push/pull or extrude";
    const exit = button(this.kept ? "Discard changes" : "Discard sketch", () => this.exit());
    exit.title = this.kept ? "Leave the sketch without saving what you changed" : "Leave the sketch and throw it away without changing the model";
    const faces = el("label", "", "Make faces ");
    const facesBox = document.createElement("input");
    facesBox.type = "checkbox";
    facesBox.checked = this.makeFaces;
    facesBox.title = "On Finish, turn the sketch's closed regions into faces of the model (a reopened sketch leaves this off so earlier faces are not doubled)";
    facesBox.addEventListener("change", () => (this.makeFaces = facesBox.checked));
    faces.append(facesBox);
    this.panel.replaceChildren(header, status, tools, constraintsBox, ...(transformRow ? [transformBox] : []), ask, list, ...(flat ? [extrude] : []), faces, finish, exit);
  }
}
