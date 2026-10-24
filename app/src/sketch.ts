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
import * as E from "./sketchedit";
import * as M from "./sketchmodel";
import { buildGridGroup, disposeGrid } from "./sketchgrid";
import * as B from "./sketchbuilders";
import * as Sn from "./sketchsnap";
import * as Pv from "./sketchpreview";
import * as T from "./sketchtyped";
import * as F from "./sketchfit";
import * as Co from "./sketchcoincident";
import { buildConstraintList, buildToolOptions, button, el, type PanelContext } from "./sketchpanelparts";
import { openSketchSettings } from "./sketchsettings";
import { parseValue } from "./dimedit";
import { uiIcon } from "./icons";
import { LENGTH_UNIT } from "./units";
import { usage } from "./usage";
import type { HandleInfo } from "./tools";
import type { Sel, Viewport } from "./viewport";

const DRAG_START_PX = 3;
const POINT_SIZE_PX = 8;
const COLORS = { line: 0x7fd1ff, selected: 0xff8a1f, hover: 0xffffff, pending: 0xffe066, construction: 0x7f8794, grid: 0x3a4150, placed: 0x8fe388, conflict: 0xff5a5a };

export type Tool = "select" | "line" | "rectangle" | "rectcentre" | "circle" | "circle3" | "arc" | "arc3" | "slot" | "point" | "polygon" | "ellipse" | "spline" | "trim" | "extend" | "split" | "triangle" | "pentagon" | "hexagon" | "octagon";
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
  { id: "polygon", label: "Polygon", hint: "Click the centre, then a corner; the number of sides is set in the sketch card (3 to 64)" },
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
  /** Number of sides the Polygon tool draws. */
  sides: number;
  /** How much the grid fades toward the edges of the view (always measured from the middle of the view, so panning never hides the grid where you look). */
  fade: "off" | "subtle" | "strong";
  /** none: tools add no constraints; snaps: only those a snap implies (horizontal, vertical, on a curve, tangent); shape: also the ones that keep a rectangle, polygon or slot its shape. */
  auto: "none" | "snaps" | "shape";
}
const OPTIONS_KEY = "pliable.sketchOptions2";

export function loadSketchOptions(): SketchOptions {
  const options: SketchOptions = { grid: false, snapGrid: false, major: 10, minor: 2, fade: "subtle", sides: 6, auto: "none" };
  try {
    const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "null");
    if (saved) {
      options.grid = saved.grid === true;
      options.snapGrid = saved.snapGrid === true;
      if (Number.isFinite(saved.major) && saved.major > 0) options.major = saved.major;
      if (Number.isFinite(saved.minor) && saved.minor >= 0) options.minor = saved.minor;
      if (["none", "snaps", "shape"].includes(saved.auto)) options.auto = saved.auto;
      if (["off", "subtle", "strong"].includes(saved.fade)) options.fade = saved.fade;
      if (Number.isInteger(saved.sides) && saved.sides >= 3 && saved.sides <= 64) options.sides = saved.sides;
    }
  } catch {
    // no saved options (or storage is blocked): the defaults stand
  }
  return options;
}

export interface SketchHost {
  /** Show a message: `error` true is red (a real failure), "warn" is orange (something worth knowing), otherwise plain. */
  status(text: string, error?: boolean | "warn"): void;
  /** Pick a point in the 3D view (null when cancelled), and keep a marker at a chosen base point (null removes it). */
  pickPoint(): Promise<number[] | null>;
  showBase(point: number[] | null): void;
  restore(): void;
  committed(mesh: MeshData): void;
}

export interface Snap {
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

export type Drag = { point: number; u: number; v: number } | { points: { point: number; u: number; v: number }[] };

export class SketchMode implements B.BuilderContext, Sn.SnapContext, PanelContext, Pv.PreviewContext {
  active = false;
  s!: M.SketchData;
  private plane = new THREE.Plane();
  tool: Tool = "select";
  selection: M.SketchSel[] = [];
  private hover: M.SketchSel | null = null;
  /** Geometry lit up while the pointer is over a row of the constraint list. */
  highlight: M.SketchSel[] = [];
  chain: Snap[] = []; // points clicked so far for the current drawing
  cursor: Snap | null = null;
  private drag: { id: number; startX: number; startY: number; moved: boolean; body?: { u: number; v: number; points: { id: number; u: number; v: number }[] } } | null = null;
  private dof: number | null = null;
  failed = new Set<number>();
  /** Directions each point can still move in (0 = placed by the constraints); empty until the first settled solve. */
  private freedom = new Map<number, number>();
  /** Whether small tags (H, V, T, =, ...) show where constraints act. */
  showMarks = true;
  private undoStack: string[] = [];
  private group = new THREE.Group();
  private normal = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: COLORS.line, linewidth: 2, depthTest: false, transparent: true }));
  private construction = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: COLORS.construction, linewidth: 2, depthTest: false, transparent: true }));
  private placed = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: COLORS.placed, linewidth: 2, depthTest: false, transparent: true }));
  private marked = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: COLORS.selected, linewidth: 3, depthTest: false, transparent: true }));
  /** The model's principal axes as they project onto the sketch plane (red x, green y, blue z). */
  private axes = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ linewidth: 1, vertexColors: true, depthTest: false, transparent: true, opacity: 0.7 }));
  private pending = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: COLORS.pending, linewidth: 2, depthTest: false, transparent: true }));
  private points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: POINT_SIZE_PX, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true }));
  private grid: THREE.Group | null = null;
  options = loadSketchOptions();
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
  private panel: HTMLElement;

  constructor(
    private readonly viewport: Viewport,
    private readonly core: CoreClient,
    private readonly overlay: DimensionOverlay,
    private readonly host: SketchHost,
    panel: HTMLElement,
  ) {
    this.panel = panel;
    window.addEventListener("keydown", this.onTyping, true);
    window.addEventListener("resize", () => { if (this.active) this.placePanel(); });
    for (const o of [this.normal, this.placed, this.construction, this.points]) o.userData.extent = true; // counted by the origin axes' length
    for (const o of [this.axes, this.normal, this.placed, this.construction, this.marked, this.pending, this.points]) {
      o.renderOrder = 5;
      o.frustumCulled = false;
      this.group.add(o);
    }
    this.axes.renderOrder = 4; // the sketch axes are drawn over the grid (order 1) and under the sketch shapes (5)
    // Keys reach onKey through the key router (keyrouter.ts), which applies the shortcut policy first.
    // A right-click (not a right-drag, which orbits) ends the line being drawn and leaves the drawing tool, back to Select.
    let rightDown: { x: number; y: number } | null = null;
    viewport.renderer.domElement.addEventListener("pointerdown", (e) => {
      if (e.button === 2) rightDown = { x: e.clientX, y: e.clientY };
    });
    viewport.renderer.domElement.addEventListener("contextmenu", (e) => {
      if (!this.active) return;
      const still = rightDown === null || Math.hypot(e.clientX - rightDown.x, e.clientY - rightDown.y) < 4;
      rightDown = null;
      if (this.chain.length) this.endChain();
      if (still && this.tool !== "select") this.setTool("select");
    });
  }

  // Entering and leaving ----------------------------------------------------------------------------

  /** Set while sketching on an unrolled cylinder face: the face the regions are wrapped back onto when finishing. */
  private unwrapFace: number[] | null = null;

  /** A kept sketch being edited: its id and name in the document; null for a new sketch. */
  private kept: { id: number; name: string } | null = null;
  /** Called with the id of the kept sketch being edited, or null when none is, so the sketch list can hide its copy of it. */
  onEditing: ((id: number | null) => void) | null = null;

  start(plane: M.PlaneData, reference?: { points: M.SketchPoint[]; entities: M.SketchEntity[] }, unwrapFace: number[] | null = null, distortion?: { max: number; note: string }, kept?: { id: number; name: string; sketch: any }) {
    if (this.active && this.needsConfirm()) {
      // Starting another sketch would throw this one away: ask first.
      void this.confirmLeave().then(async (choice) => {
        if (choice === "keep") return this.host.status("Kept editing this sketch; finish or discard it before starting another");
        if (choice === "finish") await this.finish();
        else this.exit();
        if (!this.active) this.start(plane, reference, unwrapFace, distortion, kept);
      });
      return;
    }
    if (this.active) this.exit();
    // Reference geometry (the face outline) is fixed construction geometry that sketch points can snap to.
    this.s = kept
      ? { plane: kept.sketch.plane, points: kept.sketch.points ?? [], entities: kept.sketch.entities ?? [], constraints: kept.sketch.constraints ?? [] }
      : { plane, points: reference?.points ?? [], entities: reference?.entities ?? [], constraints: [] };
    this.kept = kept ? { id: kept.id, name: kept.name } : null;
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
    this.active = true;
    this.viewport.selectItems([]); // the model's selection highlight would cover the sketch
    this.viewport.onSelect([]); // and the selection itself ends: no face, edge or body stays selected behind the sketch
    this.viewport.manipulator.clear(); // so would the selected face's push/pull arrow
    this.planeBase = null;
    this.showPlaneHandles();
    this.buildGrid(f);
    this.viewport.scene.add(this.group);
    this.viewport.interceptor = { down: (e) => this.onDown(e), move: (e) => this.onMove(e), up: (e) => this.onUp(e) };
    this.viewport.onFrame2 = () => this.onFrame();
    this.viewport.fitSource = { all: () => F.fitPointsAll(this.s), selected: () => F.fitPointsSelected(this.s, this.selection) }; // the nav cube's zoom to fit uses the sketch
    this.render();
    if (kept) void this.refreshProfiles();
    this.onToolChange?.();
    this.host.status(distortion ? distortion.note : "Sketch: choose a drawing tool in the top bar (Line, Rectangle, Circle, Arc)", !!distortion);
  }

  /** Whether leaving the sketch would lose work: drawn geometry in a new sketch, or changes to a kept one. */
  private needsConfirm(): boolean {
    return this.kept ? this.undoStack.length > 0 : this.s.entities.some((e) => !e.reference);
  }

  private leaveDialog: HTMLDialogElement | null = null;

  /** An in-page question before a sketch with work in it is thrown away. Closing it any other way keeps editing. */
  private confirmLeave(): Promise<"keep" | "finish" | "discard"> {
    if (this.leaveDialog?.open) return Promise.resolve("keep");
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.className = "sketchsettings";
      dialog.addEventListener("keydown", (e) => e.stopPropagation()); // Escape closes the question (keep editing), not the sketch
      const title = document.createElement("h3");
      title.textContent = this.kept ? "Discard your changes to this sketch?" : "Discard this sketch?";
      const text = document.createElement("div");
      text.textContent = "It has geometry that has not been kept.";
      let choice: "keep" | "finish" | "discard" = "keep";
      const choose = (c: typeof choice, label: string, autofocus = false) => {
        const b = document.createElement("button");
        b.textContent = label;
        b.addEventListener("click", () => {
          choice = c;
          dialog.close();
        });
        if (autofocus) b.autofocus = true;
        return b;
      };
      const keep = choose("keep", "Keep editing", true);
      dialog.append(title, text, keep, choose("finish", this.kept ? "Finish and save" : "Finish and keep"), choose("discard", "Discard"));
      dialog.addEventListener("close", () => {
        dialog.remove();
        this.leaveDialog = null;
        resolve(choice);
      });
      document.body.append(dialog);
      this.leaveDialog = dialog;
      dialog.showModal();
      keep.focus();
    });
  }

  /** Run a card button's action so that a failure shows in the status line (and the console) instead of the click seeming to do nothing. */
  private async guard(action: () => unknown) {
    try {
      await action();
    } catch (e) {
      console.error(e);
      this.host.status(`That did not work: ${(e as Error).message}`, true);
    }
  }

  /** Leave the sketch, asking first when it holds work (Escape and the Discard button). */
  private async leave() {
    if (this.needsConfirm()) {
      const choice = await this.confirmLeave();
      if (choice === "keep" || !this.active) return;
      if (choice === "finish") return this.finish();
    }
    this.exit();
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this.valueField?.remove();
    this.profileSeq++;
    this.setProfiles([]);
    this.cancelBox();
    this.viewport.interceptor = null;
    this.viewport.onFrame2 = null;
    this.viewport.fitSource = null;
    this.viewport.manipulator.clear();
    if (this.projectPick !== null) this.cancelProjectPick(true);
    this.viewport.scene.remove(this.group);
    if (this.grid) {
      this.group.remove(this.grid);
      disposeGrid(this.grid);
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
  /** Leave the sketch, keeping it in the document as a separate object. Its closed regions show as view-only profile faces; nothing is added to the model. */
  async finish() {
    if (!this.active) return;
    const drawn = this.s.entities.some((e) => !e.reference);
    if (!drawn && !this.kept) return this.exit(); // nothing was drawn: nothing to keep
    try {
      const mesh = await this.core.request<MeshData>("sketch_keep", {
        sketch: { ...this.s, ...(this.unwrapFace ? { unwrap: this.unwrapFace } : {}) },
        ...(this.kept ? { sketch_id: this.kept.id } : {}),
        regions: false,
      });
      this.exit();
      this.host.committed(mesh);
      usage.record("sketch_finish", "commit");
      this.host.status("Sketch kept. It stays separate from the model; its closed regions show as profile faces you can extrude from the Sketches list");
    } catch (e) {
      this.exit();
      this.host.status((e as Error).message);
    }
  }

  // Moving the sketch plane ---------------------------------------------------------------------------

  /** The plane as it was when the handle being dragged was grabbed; every drag value is measured from it. */
  private planeBase: M.PlaneData | null = null;
  /** While picking what to project: the faces and edges chosen so far (null when not picking). */
  private projectPick: Sel[] | null = null;
  /** Whether the plane's move and turn gizmos are drawn (the header's gizmo button). */
  private gizmosShown = false;
  /** The base point picked for moving the plane (null until picked). */
  private moveFrom: number[] | null = null;

  /** Gizmos on the sketch plane, like any other object's: an arrow along its normal and a turning ring about each of its axes. */
  private showPlaneHandles() {
    const manipulator = this.viewport.manipulator;
    if (!this.active || this.unwrapFace || !this.gizmosShown) return manipulator.clear();
    const f = M.frame(this.s.plane);
    const radius = 30;
    const v = (a: number[]) => new THREE.Vector3(...a);
    const ring = (param: string, label: string, about: M.Vec3, from: M.Vec3, toward: M.Vec3): HandleInfo => {
      const around = v(from).multiplyScalar(Math.SQRT1_2).addScaledVector(v(toward), Math.SQRT1_2);
      const tangent = v(toward).multiplyScalar(Math.SQRT1_2).addScaledVector(v(from), -Math.SQRT1_2);
      const anchor = v(f.origin).addScaledVector(around, radius);
      return { param, label, anchor: anchor.toArray(), direction: tangent.toArray(), scale: (180 / Math.PI) / radius, min: null, max: null, toggle: false, unit: "°", axis: about, ring: [...f.origin, radius], value: 0 };
    };
    manipulator.setHandles([
      { param: "plane_offset", label: "Move sketch plane", anchor: [...f.origin], direction: [...f.n], scale: 1, min: null, max: null, toggle: false, kind: "move", unit: LENGTH_UNIT, value: 0 },
      ring("plane_rx", "Turn sketch plane about its x axis", f.x, f.y, f.n),
      ring("plane_ry", "Turn sketch plane about its y axis", f.y, f.n, f.x),
    ]);
  }

  /** A plane handle was dragged: place the plane from where it was grabbed, offset along its normal or turned about one of its axes. */
  onPlaneDrag(param: string, value: number, phase: "move" | "end" | "cancel"): boolean {
    if (!this.active || !param.startsWith("plane_")) return false;
    this.planeBase ??= { origin: [...this.s.plane.origin], normal: [...this.s.plane.normal], xdir: [...this.s.plane.xdir] };
    const base = this.planeBase;
    const f = M.frame(base);
    const v = (a: number[]) => new THREE.Vector3(...a);
    const n = v(f.n);
    const x = v(f.x);
    const origin = v(f.origin);
    if (phase !== "cancel") {
      if (param === "plane_offset") origin.addScaledVector(n, value);
      else {
        const about = param === "plane_rx" ? x : v(f.y);
        const q = new THREE.Quaternion().setFromAxisAngle(about, (value * Math.PI) / 180);
        n.applyQuaternion(q);
        x.applyQuaternion(q);
      }
    }
    this.s.plane = { origin: origin.toArray(), normal: n.toArray(), xdir: x.toArray() };
    const g = M.frame(this.s.plane);
    this.plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(...g.n), new THREE.Vector3(...g.origin));
    this.buildGrid(g);
    this.render();
    if (phase !== "move") {
      this.planeBase = null;
      this.showPlaneHandles();
    }
    return true;
  }

  /** Pick a point in the view while the sketch is open: the point picker takes over the pointer and hands it back. */
  private async pickInView(): Promise<number[] | null> {
    const keep = this.viewport.interceptor;
    this.viewport.manipulator.clear();
    try {
      return await this.host.pickPoint();
    } finally {
      this.viewport.interceptor = keep;
      this.showPlaneHandles();
    }
  }

  /** Move the sketch plane by the vector from the picked base point to a picked destination (from the plane's own origin when no base was picked). */
  private async moveToPicked(destination: number[], from: number[]) {
    const origin = this.s.plane.origin;
    this.s.plane = { ...this.s.plane, origin: origin.map((c, k) => c + destination[k] - from[k]) };
    const f = M.frame(this.s.plane);
    this.plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(...f.n), new THREE.Vector3(...f.origin));
    this.buildGrid(f);
    this.showPlaneHandles();
    this.render();
  }

  /** The header's pick-base-point button: remember where the move starts from. */
  private async pickMoveFrom() {
    const point = await this.pickInView();
    if (!point || !this.active) return;
    this.moveFrom = point;
    this.host.showBase(point);
    this.host.status("Base point set. Now pick the location to move the sketch plane to");
    this.renderPanel();
  }

  /** The header's pick-move-to-location button: put the plane there, by the base point's offset (or its own origin). */
  private async pickMoveTo() {
    const point = await this.pickInView();
    if (!point || !this.active) return;
    const from = this.moveFrom ?? [...this.s.plane.origin];
    this.moveFrom = null;
    this.host.showBase(null);
    await this.moveToPicked(point, from);
    this.host.status("Moved the sketch plane");
    this.renderPanel();
  }

  /** The distance the pointer snaps to when snap to grid is on: the light lines when there are any, else the bold ones. */
  gridStep(): number {
    const { major, minor } = this.options;
    return minor > 0 && minor < major ? minor : major;
  }

  /** Sides of a regular polygon tool: the Polygon tool uses the count in the sketch card, the fixed shapes their own. */
  sidesOf(tool: Tool): number | undefined {
    return tool === "polygon" ? this.options.sides : POLYGON_SIDES[tool];
  }

  saveOptions() {
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(this.options));
    } catch {
      // storage blocked: the choice lasts for this session only
    }
  }

  /** Rebuild the grid for the current options (nothing when it is off). */
  private buildGrid(f: ReturnType<typeof M.frame> = M.frame(this.s.plane)) {
    if (this.grid) {
      this.group.remove(this.grid);
      disposeGrid(this.grid);
      this.grid = null;
    }
    if (!this.options.grid) return;
    this.grid = buildGridGroup(this.options, COLORS.grid, f);
    this.group.add(this.grid);
  }

  // Pointer handling --------------------------------------------------------------------------------

  planeUV(e: PointerEvent): [number, number] | null {
    const p = this.viewport.planePoint(e, this.plane);
    return p ? M.toPlane(this.s.plane, [p.x, p.y, p.z]) : null;
  }

  screenOf(u: number, v: number): THREE.Vector2 {
    return this.viewport.toScreen(new THREE.Vector3(...M.toWorld(this.s.plane, u, v)));
  }

  mousePx(e: PointerEvent): THREE.Vector2 {
    const r = this.viewport.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(e.clientX - r.left, e.clientY - r.top);
  }

  // Snap and pick rules live in sketchsnap.ts (this mode is their context).
  pixelAt(u: number, v: number): number {
    return this.viewport.pixelSizeAt(new THREE.Vector3(...M.toWorld(this.s.plane, u, v)));
  }
  private snap(e: PointerEvent): Snap | null {
    return Sn.snap(this, e);
  }
  private pick(e: PointerEvent): M.SketchSel | null {
    return Sn.pick(this, e);
  }

  /** The box being dragged on empty space (client pixels); window = left to right, crossing = right to left, as in the 3D view. */
  private box: { x0: number; y0: number; x1: number; y1: number; active: boolean; additive: boolean } | null = null;
  private boxEl: HTMLDivElement | null = null;

  private updateBox(e: PointerEvent) {
    const b = this.box!;
    b.x1 = e.clientX;
    b.y1 = e.clientY;
    if (!b.active && Math.hypot(b.x1 - b.x0, b.y1 - b.y0) < DRAG_START_PX) return;
    b.active = true;
    if (!this.boxEl) {
      this.boxEl = document.createElement("div");
      this.boxEl.style.cssText = "position:fixed;pointer-events:none;z-index:2;border:1px solid #4fc3f7;background:rgba(79,195,247,0.12)";
      document.body.appendChild(this.boxEl);
    }
    const crossing = b.x1 < b.x0;
    Object.assign(this.boxEl.style, {
      left: Math.min(b.x0, b.x1) + "px",
      top: Math.min(b.y0, b.y1) + "px",
      width: Math.abs(b.x1 - b.x0) + "px",
      height: Math.abs(b.y1 - b.y0) + "px",
      borderStyle: crossing ? "dashed" : "solid", // dashed = crossing, solid = window
      borderColor: crossing ? "#8bc34a" : "#4fc3f7",
    });
  }

  private cancelBox() {
    this.box = null;
    this.boxEl?.remove();
    this.boxEl = null;
  }

  /** Select the sketch's own points and curves in the box (never the model's faces or edges). */
  private finishBox() {
    const b = this.box!;
    this.cancelBox();
    if (!b.active) {
      if (!b.additive) this.selection = []; // a click on empty space
      return;
    }
    const rect = this.viewport.renderer.domElement.getBoundingClientRect();
    const r = { x0: Math.min(b.x0, b.x1) - rect.left, x1: Math.max(b.x0, b.x1) - rect.left, y0: Math.min(b.y0, b.y1) - rect.top, y1: Math.max(b.y0, b.y1) - rect.top };
    const found = M.itemsInBox(this.s, (u, v) => this.screenOf(u, v), r, b.x1 < b.x0);
    this.selection = b.additive ? [...this.selection, ...found.filter((f) => !this.selection.some((s) => s.kind === f.kind && s.id === f.id))] : found;
  }

  private onMove(e: PointerEvent) {
    // A release the page never saw (focus lost, a dialog) must not leave a drag or box stuck to the pointer.
    if (e.buttons === 0 && (this.box || this.drag)) {
      this.cancelBox();
      this.drag = null;
      this.clickToggle = null;
    }
    if (this.box) {
      this.updateBox(e);
      return;
    }
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

  /** A press on an item that was already selected: a click without movement removes it from the selection. */
  private clickToggle: { sel: M.SketchSel; x: number; y: number } | null = null;

  private onDown(e: PointerEvent) {
    if (this.projectPick !== null) return this.pickToProject(e);
    if (this.tool !== "select") return;
    const hit = this.pick(e);
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    const same = (s: M.SketchSel) => !!hit && s.kind === hit.kind && s.id === hit.id;
    const wasSelected = this.selection.some(same);
    this.clickToggle = null;
    if (!hit) {
      // Empty space: a click clears the selection, a drag draws a selection box (see finishBox).
      this.box = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, active: false, additive };
      this.viewport.renderer.domElement.setPointerCapture(e.pointerId);
    } else if (additive) {
      this.selection = wasSelected ? this.selection.filter((s) => !same(s)) : [...this.selection, hit];
    } else if (wasSelected) {
      this.clickToggle = { sel: hit, x: e.clientX, y: e.clientY }; // decided on release: a drag moves the whole selection instead
    } else {
      this.selection = [...this.selection, hit]; // clicking adds: no modifier key needed
    }
    if (hit && !additive) this.startDrag(e, wasSelected ? this.selection : [hit]);
    this.render();
  }

  /** Begin dragging the given items: one point follows the pointer; curves and several items move as a whole, the rest follows the constraints. */
  private startDrag(e: PointerEvent, items: M.SketchSel[]) {
    const uv = this.planeUV(e);
    if (!uv) return;
    const point = (id: number) => this.s.points.find((p) => p.id === id);
    if (items.length === 1 && items[0].kind === "point") {
      if (point(items[0].id)?.fixed) return;
      this.drag = { id: items[0].id, startX: e.clientX, startY: e.clientY, moved: false };
      this.viewport.renderer.domElement.setPointerCapture(e.pointerId);
      return;
    }
    const ids = new Set<number>();
    for (const it of items) {
      if (it.kind === "point") {
        if (!point(it.id)?.fixed) ids.add(it.id);
        continue;
      }
      const entity = this.s.entities.find((x) => x.id === it.id);
      if (!entity || entity.reference) continue;
      const held = M.entityPoints(entity).map(point);
      if (held.every((p) => p && !p.fixed)) for (const p of held) ids.add(p!.id);
    }
    if (!ids.size) return;
    const held = [...ids].map((id) => point(id)!);
    this.drag = { id: 0, startX: e.clientX, startY: e.clientY, moved: false, body: { u: uv[0], v: uv[1], points: held.map((p) => ({ id: p.id, u: p.u, v: p.v })) } };
    this.viewport.renderer.domElement.setPointerCapture(e.pointerId);
  }

  private async onUp(e: PointerEvent) {
    if (this.box) {
      this.finishBox();
      this.render();
      return;
    }
    const toggle = this.clickToggle;
    this.clickToggle = null;
    if (toggle && Math.hypot(e.clientX - toggle.x, e.clientY - toggle.y) < DRAG_START_PX) {
      this.selection = this.selection.filter((s) => !(s.kind === toggle.sel.kind && s.id === toggle.sel.id));
      this.drag = null;
      this.render();
      return;
    }
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

  /** A shape is complete: every drawing tool but Line is left for Select, so the next click selects (smarter continuing is on the watchlist). */
  private shapeDone() {
    this.chain = [];
    this.setTool("select");
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
        this.shapeDone();
        return;
      }
    } else if (this.tool === "ellipse" && this.chain.length === 3) {
      this.addEllipse(this.chain[0], this.chain[1], this.chain[2]);
      this.shapeDone();
    } else if ((this.tool === "rectangle" || this.tool === "rectcentre") && this.chain.length === 2) {
      this.addRectangle(this.chain[0], this.chain[1], this.tool === "rectcentre");
      this.shapeDone();
    } else if (this.tool === "circle" && this.chain.length === 2) {
      this.addCircle(this.chain[0], this.chain[1]);
      this.shapeDone();
    } else if (this.sidesOf(this.tool) && this.chain.length === 2) {
      this.addPolygon(this.chain[0], this.chain[1], this.sidesOf(this.tool)!);
      this.shapeDone();
    } else if (this.tool === "arc" && this.chain.length === 3) {
      this.addArc(this.chain[0], this.chain[1], this.chain[2]);
      this.shapeDone();
    } else if (this.tool === "arc3" && this.chain.length === 3) {
      this.addArcThrough(this.chain[0], this.chain[1], this.chain[2]);
      this.shapeDone();
    } else if (this.tool === "circle3" && this.chain.length === 3) {
      this.addCircleThrough(this.chain[0], this.chain[1], this.chain[2]);
      this.shapeDone();
    } else if (this.tool === "slot" && this.chain.length === 3) {
      this.addSlot(this.chain[0], this.chain[1], this.chain[2]);
      this.shapeDone();
    } else if (this.tool === "point") {
      this.pushUndo();
      this.pointFor(snap);
      this.shapeDone();
      this.resolve();
    }
    this.cursor = null;
    this.render();
  }

  /** The numbers the current drawing tool takes at this stage (empty when it takes none): typing starts an entry. */
  private typedLabels(): string[] {
    return this.active ? T.typedLabels(this.tool, this.chain.length, !!this.sidesOf(this.tool)) : [];
  }

  /** Keys typed while drawing (captured before the key router sees them). Digits start the entry, Tab or space moves to the next number, Enter applies, Backspace edits, Escape clears. */
  private onTyping = (e: KeyboardEvent) => {
    const labels = this.typedLabels();
    if (!labels.length || e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).closest("input, select, textarea")) return;
    const next = T.typedKey(this.typed, e.key, labels.length);
    if (next !== null) this.typed = next;
    else if (e.key === "Enter" && this.typed) void this.applyTyped();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (this.typed) {
      const field = Math.min(labels.length - 1, this.typed.trim().split(/\s+/).length - (this.typed.endsWith(" ") ? 0 : 1));
      this.host.status(`Typing the ${labels[field]}: ${this.typed}| (${labels.length > 1 ? `${labels.join(", ")}; Tab for the next number, ` : ""}Enter places it)`);
    }
    this.render();
  };
  typed = "";

  /** Place the next points at the typed sizes in the pointer's direction and keep the typed sizes as dimensions where the shape has them. */
  private async applyTyped() {
    const numbers = T.parseTyped(this.typed);
    this.typed = "";
    if (!numbers) return this.host.status("That is not a positive size", true);
    const tool = this.tool; // placing the last point can leave the tool
    const [w, h] = [numbers[0], numbers[1] ?? numbers[0]];
    const before = this.s.entities.length;
    for (const target of T.typedTargets(tool, this.chain, this.cursor, numbers.slice(0, this.typedLabels().length))) this.place({ ...target });
    const made = this.s.entities.slice(before);
    const plain = !made.some((x) => x.type === "arc"); // a rounded rectangle's sides are not its overall size
    let dimensions: Omit<M.SketchConstraint, "id">[] = [];
    if (tool === "line" && made[0]?.type === "line") dimensions = [{ type: "distance", entity: made[0].id, value: w }];
    else if (tool === "circle" && made[0]?.type === "circle") dimensions = [{ type: "radius", entity: made[0].id, value: w }];
    else if ((tool === "rectangle" || tool === "rectcentre") && plain && made.length >= 2) {
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
    if (this.tool === "spline" && this.chain.length >= 2) {
      this.addSpline(false);
      return this.shapeDone();
    }
    this.chain = [];
    this.chainStart = undefined;
    this.cursor = null;
    this.render();
  }

  onKey(e: KeyboardEvent) {
    if (!this.active || this.settingsDialog?.open || this.leaveDialog?.open) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, select, textarea")) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.undo();
    } else if (this.projectPick !== null && (e.key === "Escape" || e.key === "Enter")) {
      if (e.key === "Enter") void this.guard(() => this.finishProjectPick());
      else this.cancelProjectPick();
    } else if (e.key === "Escape") {
      if (this.chain.length) this.endChain();
      else if (this.tool !== "select") this.setTool("select");
      else if (this.selection.length) this.selection = [], this.render();
      else void this.leave(); // nothing left to cancel: leave the sketch (asking first if it holds work)
    } else if (e.key === "Enter" && this.chain.length) {
      this.endChain();
    } else if ((e.key === "Delete" || e.key === "Backspace") && this.selection.length) {
      // Only points selected and something holds them to other geometry: Delete lets go of that (the lines stay).
      const released = this.selection.every((x) => x.kind === "point") ? Co.releasePoints(this.s, this.selection.map((x) => x.id)) : null;
      this.pushUndo();
      if (released) {
        this.s = released;
        this.selection = [];
        this.resolve();
        this.render();
        return this.host.status("Removed the coincidence at the selected points; the lines stay");
      }
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

  pushUndo() {
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
  pointFor(snap: Snap): number {
    if (snap.id !== undefined) return snap.id;
    const id = M.nextId(this.s);
    this.s.points.push({ id, u: snap.u, v: snap.v });
    snap.id = id;
    if (snap.on) this.addConstraintRaw(snap.on.midpoint ? { type: "midpoint", point: id, entity: snap.on.entity } : { type: "point_on", point: id, entity: snap.on.entity }, "snap");
    return id;
  }

  /** A constraint a drawing tool adds on its own: "snap" ones follow from where you clicked, "shape" ones keep a rectangle, polygon or slot its shape. Whether either is added is the sketch option `auto`. */
  addConstraintRaw(c: Omit<M.SketchConstraint, "id">, kind: "snap" | "shape" = "shape") {
    if (this.options.auto === "none" || (this.options.auto === "snaps" && kind === "shape")) return;
    this.s.constraints.push({ id: M.nextId(this.s), ...c, auto: true }); // every caller is a drawing tool, not the user
  }

  // Drawing tools: the work is in sketchbuilders.ts, which takes this mode as its context.
  chainStart?: Snap;
  rectOptions: { corner: "none" | "fillet" | "chamfer"; size: number } = { corner: "none", size: 5 };
  status(text: string, error?: boolean | "warn") {
    this.host.status(text, error);
  }
  private addLine(a: Snap, b: Snap): boolean {
    return B.addLine(this, a, b);
  }
  private addRectangle(a: Snap, b: Snap, centred = false) {
    B.addRectangle(this, a, b, centred);
  }
  private addPolygon(center: Snap, corner: Snap, sides: number) {
    B.addPolygon(this, center, corner, sides);
  }
  private addCircle(center: Snap, edge: Snap) {
    B.addCircle(this, center, edge);
  }
  private addEllipse(center: Snap, major: Snap, side: Snap) {
    B.addEllipse(this, center, major, side);
  }
  private addSpline(closed: boolean) {
    B.addSpline(this, closed);
  }
  private addArcThrough(start: Snap, through: Snap, end: Snap) {
    B.addArcThrough(this, start, through, end);
  }
  private addCircleThrough(a: Snap, b: Snap, c: Snap) {
    B.addCircleThrough(this, a, b, c);
  }
  private addSlot(a: Snap, b: Snap, side: Snap) {
    B.addSlot(this, a, b, side);
  }
  private addArc(center: Snap, start: Snap, end: Snap) {
    B.addArc(this, center, start, end);
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

/** The constraint and dimension buttons of the sketch strip: every one, enabled when the selection takes it. */  constraintChoices(): { label: string; enabled: boolean }[] {    return M.allConstraintOptions(this.s, this.selection).map((c) => ({ label: c.option.label, enabled: c.enabled }));  }  /** Apply the strip button with this label to the selection. */  chooseConstraint(label: string) {    const chosen = M.allConstraintOptions(this.s, this.selection).find((c) => c.option.label === label);    if (chosen?.enabled) void this.applyConstraint(chosen.option);    else if (chosen) this.host.status(`${label} does not fit the current selection`, "warn");  }
  private async applyConstraint(chosen: M.ConstraintOption) {
    const option = chosen.pick?.(this.s, this.selection) ?? chosen; // the smart dimension stands for one of the others
    const built = option.build(this.s, this.selection);
    if (!built) return;
    // A dimension is created at once with its current value and opened for editing on the sketch (Escape keeps the value).
    if (option.dimension) built.value = option.initial!(this.s, this.selection);
    this.pushUndo();
    const before = JSON.stringify(this.s);
    const addedIds = new Set<number>();
    for (const one of M.constraintsToAdd(option, this.s, this.selection)) {
      const added = { id: M.nextId(this.s), ...one, ...(built.value !== undefined ? { value: built.value } : {}) };
      this.s.constraints.push(added);
      addedIds.add(added.id);
    }
    const ok = await this.resolve();
    if (ok && option.dimension) {
      this.render();
      const id = [...addedIds][0];
      this.afterDraw(() => {
        const at = this.overlay.labelOfConstraint(id);
        if (at) this.editInline(id, at, true);
      });
    }
    if (!ok) {
      const clash = this.s.constraints.filter((c) => this.failed.has(c.id) && !addedIds.has(c.id)).map((c) => M.describeConstraint(this.s, c));
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
    this.settingsDialog = openSketchSettings(this.options, { save: () => this.saveOptions(), rebuildGrid: () => this.buildGrid(), closed: () => (this.settingsDialog = null) });
  }

  /** Run `then` once the dimensions have been drawn (the overlay redraws every frame). */
  private afterDraw(then: () => void) {
    requestAnimationFrame(() => requestAnimationFrame(then));
  }

  private valueField: HTMLElement | null = null;

  /** A number field on the sketch at a dimension's text. Enter sets the value (one undo step, or none more when `fresh`: the
   * constraint was just created and its creation is the step); Escape or clicking away leaves the value as it is. */
  private editInline(id: number, at: { x: number; y: number }, fresh = false) {
    this.valueField?.remove();
    const c = this.s.constraints.find((x) => x.id === id);
    if (!c || c.value === undefined) return;
    const box = document.createElement("div");
    box.style.cssText = `position:absolute;left:${at.x}px;top:${at.y}px;transform:translate(-50%,-50%);z-index:20;font:13px system-ui,sans-serif`;
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "decimal";
    input.setAttribute("aria-label", M.describeConstraint(this.s, c).replace(/ = .*$/, ""));
    input.style.cssText = "width:78px;padding:2px 5px;font:inherit;color:#ff8a1f;background:#1b1d22;border:1px solid #ff8a1f;border-radius:3px;outline:none;text-align:center";
    input.value = String(parseFloat(c.value.toFixed(3)));
    box.append(input);
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick"]) box.addEventListener(type, (e) => e.stopPropagation());
    let closed = false;
    const close = () => {
      if (closed) return; // removing the field blurs it, which calls this again
      closed = true;
      box.remove();
      if (this.valueField === box) this.valueField = null;
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const value = parseValue(input.value);
        if (value === null) {
          input.style.borderColor = "#ff4d4d";
          return;
        }
        close();
        const change = (cs: M.SketchConstraint[]) => cs.map((x) => (x.id === id ? { ...x, value } : x));
        const failure = "That value conflicts with other constraints, so it was not changed";
        if (!fresh) void this.changeConstraints(change, failure);
        else {
          const before = JSON.stringify(this.s);
          this.s.constraints = change(this.s.constraints);
          void this.resolve().then(async (ok) => {
            if (!ok) {
              this.s = JSON.parse(before);
              await this.resolve();
              this.host.status(failure, true);
            }
            this.render();
          });
        }
      }
    });
    input.addEventListener("blur", close);
    this.valueField = box;
    this.viewport.renderer.domElement.parentElement!.append(box);
    input.focus();
    input.select();
  }

  /** Change the value of an existing dimension; a value the other constraints refuse is undone. */
  async editDimension(id: number) {
    const c = this.s.constraints.find((x) => x.id === id);
    if (!c || c.value === undefined) return;
    const answer = await this.askNumber(M.describeConstraint(this.s, c).replace(/ = .*$/, ""), c.value);
    if (answer === null || answer.reference) return;
    await this.changeConstraints((cs) => cs.map((x) => (x.id === id ? { ...x, value: answer.value } : x)), "That value conflicts with other constraints, so it was not changed");
  }

  /** Switch a dimension between driving the shape and only measuring it; a driving one starts from the current measurement. */
  async toggleReference(id: number) {
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
  resolve(drag?: Drag): Promise<boolean> {
    this.queued = { drag };
    if (this.solving) return Promise.resolve(true);
    return this.runSolve();
  }

  private profileFills: THREE.Mesh[] = [];
  private profileSeq = 0;

  /** The sketch's closed regions as view-only tinted faces, redrawn after every solve, so a closed profile shows at once. */
  private async refreshProfiles() {
    const seq = ++this.profileSeq;
    let profiles: { positions: number[]; indices: number[] }[] = [];
    try {
      profiles = (await this.core.request<{ profiles: typeof profiles }>("sketch_profiles", { sketch: M.forSolver(this.s) })).profiles;
    } catch {
      // a sketch the core cannot split into regions simply shows none
    }
    if (seq === this.profileSeq && this.active) this.setProfiles(profiles);
  }

  private profileData: { positions: number[]; indices: number[] }[] = [];
  private triangleCache: { data: unknown; key: string; triangles: number[][][] } | null = null;

  /** Whether a sketch point lies inside a closed region (a tinted profile face), and how far to look from the geometry (about 40 px): dimensions are placed outside the faces. */
  private outside(): M.Outside | undefined {
    if (!this.profileData.length || !this.s.constraints.some((c) => c.value !== undefined || c.reference)) return undefined;
    const key = JSON.stringify(this.s.plane);
    if (this.triangleCache?.data !== this.profileData || this.triangleCache.key !== key) {
      const triangles = this.profileData.flatMap((m) => {
        const uv = (i: number) => M.toPlane(this.s.plane, [m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]]);
        return Array.from({ length: Math.floor(m.indices.length / 3) }, (_, t) => [uv(m.indices[3 * t]), uv(m.indices[3 * t + 1]), uv(m.indices[3 * t + 2])]);
      });
      this.triangleCache = { data: this.profileData, key, triangles };
    }
    const triangles = this.triangleCache.triangles;
    const inside = (u: number, v: number) =>
      triangles.some(([a, b, c]) => {
        const side = (p: number[], q: number[]) => (q[0] - p[0]) * (v - p[1]) - (q[1] - p[1]) * (u - p[0]);
        const [x, y, z] = [side(a, b), side(b, c), side(c, a)];
        return (x >= 0 && y >= 0 && z >= 0) || (x <= 0 && y <= 0 && z <= 0);
      });
    return { inside, probe: this.pixelAt(0, 0) * 40 };
  }

  /** Move a dimension's text (and with it the line or leader) to where the pointer is; the first move is one undo step. */
  private dragDimension(id: number, e: PointerEvent) {
    const at = this.planeUV(e);
    const c = this.s.constraints.find((x) => x.id === id);
    if (!at || !c) return;
    if (this.draggedDimension !== id) {
      this.pushUndo();
      this.draggedDimension = id;
      window.addEventListener("pointerup", () => (this.draggedDimension = null), { once: true, capture: true });
    }
    c.place = at;
    this.render(false);
  }
  private draggedDimension: number | null = null;

  private setProfiles(profiles: { positions: number[]; indices: number[] }[]) {
    this.profileData = profiles;
    if (this.s.constraints.some((c) => c.value !== undefined || c.reference)) this.render(false); // dimensions are placed outside the regions
    for (const old of this.profileFills) {
      this.group.remove(old);
      old.geometry.dispose();
      (old.material as THREE.Material).dispose();
    }
    this.profileFills = profiles.map((m) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(m.positions, 3));
      geometry.setIndex(m.indices);
      const material = new THREE.MeshBasicMaterial({ color: 0x2fd4c0, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, depthTest: false });
      const fill = new THREE.Mesh(geometry, material);
      fill.renderOrder = 3; // under the sketch lines (5) and axes (4), over the grid (1)
      fill.frustumCulled = false;
      this.group.add(fill);
      return fill;
    });
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
          reply = await this.core.request<SolveReply>("sketch_solve", { sketch: M.forSolver(this.s), drag: job.drag, detail: !job.drag });
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
          if (!job.drag) void this.refreshProfiles();
        } else if (!job.drag) {
          this.failed = new Set([...reply.failed, ...(reply.conflicts ?? [])].filter((x): x is number => x !== null));
          ok = false;
          if (!this.failed.size) this.host.status("The sketch could not be solved, so geometry will not follow its constraints. Undo the last change", true);
        }
        this.render();
      }
    } finally {
      this.solving = false;
    }
    return ok;
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

  /** The Project button: start picking the faces and edges to project, or project what is picked so far. */
  private async toggleProjectPick() {
    if (this.projectPick === null) {
      this.projectPick = [];
      this.viewport.selectItems([]);
      this.host.status("Project: click the faces and edges of the model to project (click again to remove one). Click Project again or press Enter to finish, Escape to cancel");
      this.renderPanel();
      return;
    }
    await this.finishProjectPick();
  }

  /** A click while picking: toggle the face or edge under the pointer. */
  private pickToProject(e: PointerEvent) {
    const hit = this.viewport.pickModelItem(e);
    if (!hit || this.projectPick === null) return;
    const has = this.projectPick.some((s) => s.kind === hit.kind && s.id === hit.id);
    this.projectPick = has ? this.projectPick.filter((s) => !(s.kind === hit.kind && s.id === hit.id)) : [...this.projectPick, hit];
    this.viewport.selectItems(this.projectPick);
    this.host.status(`Project: ${this.projectPick.length} picked. Click Project again or press Enter to finish, Escape to cancel`);
    this.renderPanel();
  }

  private cancelProjectPick(quiet = false) {
    this.projectPick = null;
    this.viewport.selectItems([]);
    if (!quiet) {
      this.host.status("Project cancelled");
      this.renderPanel();
    }
  }

  private async finishProjectPick() {
    const picked = this.projectPick ?? [];
    if (!picked.length) return this.cancelProjectPick();
    this.projectPick = null;
    this.viewport.selectItems([]);
    this.renderPanel();
    await this.projectModel(picked);
  }

  /** Flatten the picked faces and edges onto the sketch plane as fixed reference geometry the sketch can snap to. */
  private async projectModel(picked: Sel[]) {
    try {
      const ref = await this.core.request<{ points: M.SketchPoint[]; entities: M.SketchEntity[]; skipped?: { square: number; tilted_circles: number; other: number }; drawn?: { ellipses: number; splines: number } }>("sketch_project", { plane: this.s.plane, faces: picked.filter((p) => p.kind === "face").map((p) => p.id), edges: picked.filter((p) => p.kind === "edge").map((p) => p.id) });
      if (!this.active) return; // the sketch was left while the model was being projected
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
        ref.drawn?.ellipses ? `${ref.drawn.ellipses} tilted circle${ref.drawn.ellipses === 1 ? "" : "s"} drawn as ellipses` : "",
        ref.drawn?.splines ? `${ref.drawn.splines} tilted arc or curved edge${ref.drawn.splines === 1 ? "" : "s"} drawn as splines` : "",
        sk?.tilted_circles ? `${sk.tilted_circles} arc${sk.tilted_circles === 1 ? "" : "s"} seen edge-on not drawn, their end points are snappable` : "",
        sk?.other ? `${sk.other} curved edge${sk.other === 1 ? "" : "s"} of another kind skipped, their end points are snappable` : "",
        sk?.square ? `${sk.square} edge${sk.square === 1 ? "" : "s"} seen end-on shown as points` : "",
      ].filter(Boolean);
      this.host.status(`${added ? `Projected ${added} model edge${added === 1 ? "" : "s"}` : "No new model edges to project"}${notes.length ? `. ${notes.join("; ")}` : ""}`, sk?.tilted_circles || sk?.other ? "warn" : false);
    } catch (e) {
      this.host.status((e as Error).message, true);
    } finally {
      // Whatever happened above, the sketch must stay usable.
      this.drag = null;
      this.clickToggle = null;
      this.cancelBox();
      if (this.active) this.render();
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

  lightUp(c: M.SketchConstraint | null) {
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

  render(panel = true) {
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
    const dimensions = M.dimensionsOf(this.s, this.outside()).map((d) => {
      const c = this.s.constraints.find((x) => x.id === d.constraint);
      if (!c) return d;
      const drag = (e: PointerEvent) => this.dragDimension(c.id, e);
      return !c.reference && c.value !== undefined ? { ...d, drag, activate: (at: { x: number; y: number }) => this.editInline(c.id, at) } : { ...d, drag };
    });
    this.overlay.set([...dimensions, ...(this.showMarks ? M.constraintMarks(this.s) : []), ...this.liveDimensions()]);
    if (panel) this.renderPanel();
    this.onToolChange?.(); // the strip's constraint row follows the selection
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
    return Pv.liveDimensions(this);
  }

  /** Rubber-band shapes for the drawing in progress. */
  private pendingShapes(): [number, number][][] {
    return Pv.pendingShapes(this);
  }

  // Panel -------------------------------------------------------------------------------------------

  /** The card starts just under the nav cube group, so it has all the room below for a long constraint list. */
  private placePanel() {
    const cube = document.getElementById("navcube")?.getBoundingClientRect();
    const top = cube && cube.height > 0 ? Math.round(cube.bottom) + 8 : 270;
    this.panel.style.top = `${top}px`;
    this.panel.style.maxHeight = `${Math.max(160, window.innerHeight - top - 12)}px`;
  }

  private renderPanel() {
    this.placePanel();
    const keepAsk = this.panel.querySelector<HTMLElement>(".ask");
    const asking = keepAsk && !keepAsk.hidden;
    if (asking) return; // do not rebuild while a value is being typed
    this.panel.hidden = false;

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
    const look = iconButton("lookAt", "Turn the view square to the sketch plane in orthographic projection (entering a sketch does not move the view). Turning the camera afterwards goes back to the projection you had", () => this.viewport.lookFromOrthographic(new THREE.Vector3(...M.frame(this.s.plane).n)));
    const gizmos = iconButton("gizmos", this.gizmosShown ? "Hide the sketch plane's move and turn gizmos" : "Show the sketch plane's move and turn gizmos", () => {
      this.gizmosShown = !this.gizmosShown;
      this.showPlaneHandles();
      this.renderPanel();
    }, this.gizmosShown);
    const base = iconButton("pickBase", "Pick base point: click the point the sketch plane moves from (a vertex, edge, face centre, axis or the origin); then use Pick move to location", () => void this.pickMoveFrom(), this.moveFrom !== null);
    const target = iconButton("pickTarget", "Pick move to location: click where the sketch plane goes (it moves by the offset from the base point, or from its own origin when none was picked)", () => void this.pickMoveTo());
    const gear = iconButton("gear", "Sketch settings", () => this.openSettings());
    gear.style.marginLeft = "auto";
    header.append(el("span", "title", this.kept ? this.kept.name : "Sketch"), gear);
    const icons = el("div", "head");
    icons.append(look, gizmos, base, target, grid, snap);
    const status = el("div", "dof", this.failed.size ? `Conflict: ${this.s.constraints.filter((c) => this.failed.has(c.id)).map((c) => M.describeConstraint(this.s, c)).join("; ") || [...this.failed].join(", ")}. Remove one (red rows below)` : this.dof === null ? "" : this.dof === 0 ? "Fully constrained" : `${this.dof} degrees of freedom left`);
    if (this.failed.size) status.classList.add("bad");

    const tools = buildToolOptions(this);

    // The constraint and dimension buttons live in the strip at the top; the card keeps the other selection tools.
    const constraintsBox = el("div", "section");
    constraintsBox.append(el("div", "group", this.selection.length ? "Selection" : "Select items to edit"));

    const transformRow = this.transformButtons();
    const transformBox = el("div", "section");
    if (transformRow) transformBox.append(el("div", "group", "Edit selection"), transformRow);
    const ask = el("div", "ask");
    ask.hidden = true;

    const list = buildConstraintList(this);

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
      construction.title = "Construction geometry guides the sketch but is not part of the profile";
      constraintsBox.append(construction);
    }

    const flat = this.unwrapFace === null;
    const picking = this.projectPick !== null;
    const project = button(picking ? `Project ${this.projectPick!.length} picked: done` : "Project model edges", () => void this.guard(() => this.toggleProjectPick()));
    project.classList.toggle("active", picking);
    project.title = picking ? "Project the picked faces and edges now (Enter), or press Escape to cancel" : "Pick faces and edges of the model, then flatten them onto this plane as fixed geometry to snap and constrain to";
    if (flat) constraintsBox.append(project);

    const finish = button("Finish sketch", () => void this.guard(() => this.finish()));
    finish.title = "Leave the sketch and keep it in the list of sketches. It stays separate from the model; its closed regions show as profile faces you can extrude";
    const exit = button(this.kept ? "Discard changes" : "Discard sketch", () => void this.guard(() => this.leave()));
    exit.title = this.kept ? "Leave the sketch without saving what you changed" : "Leave the sketch and throw it away without changing the model";
    const leaving = el("div", "row-buttons");
    leaving.append(finish, exit);
    this.panel.replaceChildren(header, icons, leaving, status, tools, constraintsBox, ...(transformRow ? [transformBox] : []), ask, list);
  }
}
