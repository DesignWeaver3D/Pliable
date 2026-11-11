/**
 * Sketch mode: draw on a plane in the 3D view (no separate workbench), constrain with the solver in the core,
 * then extrude the profile. All sketch rules live in sketchmodel.ts; this file is the interaction and drawing.
 */
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { CoreClient, MeshData } from "./client.ts";
import type { DimensionOverlay } from "./dimensions.ts";
import * as M from "./sketchmodel.ts";
import { disposeGrid } from "./sketchgrid.ts";
import * as B from "./sketchbuilders.ts";
import * as Sn from "./sketchsnap.ts";
import * as Pv from "./sketchpreview.ts";
import * as T from "./sketchtyped.ts";
import * as F from "./sketchfit.ts";
import * as Dr from "./sketchdraw.ts";
import { COLORS } from "./sketchdraw.ts";
import { defaultArcOptions } from "./sketcharcoptions.ts";
import { BareAltPress } from "./sketchaltpress.ts";
import { loadSketchOptions, OPTIONS_KEY } from "./sketchoptions.ts";
import { sketchSelectionText } from "./selectedreadout.ts";
import { type PanelContext } from "./sketchpanelparts.ts";
import { openSketchSettings } from "./sketchsettings.ts";
import { usage } from "./usage.ts";
import { askForm, askNumber } from "./sketchasks.ts";
import { createSolver } from "./sketchsolve.ts";
import { FREE_COLOR } from "./sketchfreedom.ts";
import { SKETCH_TOOLS } from "./sketchtypes.ts";
import type { Drag, SketchHost, Snap, Tool } from "./sketchtypes.ts";
import type { Sel, Viewport } from "./viewport.ts";
import { confirmLeave, needsConfirm } from "./sketchleave.ts";
import { onPlaneDrag, showPlaneHandles } from "./sketchplanemove.ts";
import { cancelBox, endChain, onDown, onMove, onUp } from "./sketchpointer.ts";
import { applyTyped, typedLabels } from "./sketchtypedapply.ts";
import { onKey } from "./sketchkeydown.ts";
import { pushUndo, undoStep } from "./sketchundo.ts";
import { chooseConstraint, constraintChoices } from "./sketchconstrain.ts";
import { editDimension, setReference, toggleReference } from "./sketchdimactions.ts";
import { toggleConstruction } from "./sketchtransform.ts";
import { cancelProjectPick } from "./sketchproject.ts";
import { refreshFreedom, refreshProfiles, resolveSketch, setProfiles } from "./sketchrefresh.ts";
import { buildGrid, lightUp, onFrame, renderSketch } from "./sketchrender.ts";
import { placePanel } from "./sketchpanel.ts";

const POINT_SIZE_PX = 8;

/** Regular polygon tools: the center then a corner; the number of sides is the only difference between them. */
const POLYGON_SIDES: Partial<Record<Tool, number>> = { triangle: 3, pentagon: 5, hexagon: 6, octagon: 8 };

export { loadSketchOptions, OPTIONS_KEY, type SketchOptions } from "./sketchoptions.ts";


export class SketchMode implements Dr.DrawContext, B.BuilderContext, Sn.SnapContext, PanelContext, Pv.PreviewContext {
  active = false;
  s!: M.SketchData;
  plane = new THREE.Plane();
  tool: Tool = "select";
  selection: M.SketchSel[] = [];
  hover: M.SketchSel | null = null;
  /** Geometry lit up while the pointer is over a row of the constraint list. */
  highlight: M.SketchSel[] = [];
  chain: Snap[] = []; // points clicked so far for the current drawing
  cursor: Snap | null = null;
  drag: { id: number; startX: number; startY: number; moved: boolean; resize?: number; body?: { u: number; v: number; points: { id: number; u: number; v: number }[] } } | null = null;
  dof: number | null = null;
  failed = new Set<number>();
  /** Directions each point can still move in (0 = placed by the constraints); empty until the first settled solve. */
  freedom = new Map<number, number>();
  /** Circles whose radius is not fixed yet: not drawn as fully constrained even when their center is placed. */
  freeSizes = new Set<number>();
  /** Set by clicking the degrees of freedom message: the points and curves that still have freedom light up yellow. */
  showFree = false;
  /** Whether small tags (H, V, T, =, ...) show where constraints act. */
  showMarks = true;
  undoStack: string[] = [];
  group = new THREE.Group();
  normal = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: COLORS.line, linewidth: 2, depthTest: false, transparent: true }));
  construction = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: COLORS.construction, linewidth: 2, depthTest: false, transparent: true, dashed: true, dashSize: 1, gapSize: 1 })); // dash lengths are set per frame, in screen pixels
  placed = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: COLORS.placed, linewidth: 2, depthTest: false, transparent: true }));
  free = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: FREE_COLOR, linewidth: 3, depthTest: false, transparent: true }));
  marked = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: COLORS.selected, linewidth: 3, depthTest: false, transparent: true }));
  /** The model's principal axes as they project onto the sketch plane (red x, green y, blue z). */
  axes = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ linewidth: 1, vertexColors: true, depthTest: false, transparent: true, opacity: 0.7 }));
  pending = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: COLORS.pending, linewidth: 2, depthTest: false, transparent: true }));
  /** A small cross at the center of every circle and arc, as in technical drawings. */
  centres = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ vertexColors: true, linewidth: 2, depthTest: false, transparent: true })); // each cross is colored like its curve
  centreColours = new Map<number, number>(); // the color of each circle's and arc's cross, set as the curves are drawn
  centresAt = 0; // the pixel size the crosses were last built for
  points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: POINT_SIZE_PX, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true }));
  grid: THREE.Group | null = null;
  options = loadSketchOptions();
  settingsDialog: HTMLDialogElement | null = null;
  /** Called when the active drawing tool, or whether a sketch is open, changes (the top strip redraws). */
  onToolChange: (() => void) | null = null;

  /** The names of the selected points and curves, for the readout bottom right. */
  selectionText(): string {
    return sketchSelectionText(this.s, this.selection);
  }

  get activeTool(): Tool {
    return this.tool;
  }

  /** Choose a drawing tool (from the top strip). */
  selectTool(tool: Tool) {
    if (this.active) this.setTool(tool);
  }
  solver: ReturnType<typeof createSolver>;
  panel: HTMLElement;

  constructor(
    readonly viewport: Viewport,
    readonly core: CoreClient,
    readonly overlay: DimensionOverlay,
    readonly host: SketchHost,
    panel: HTMLElement,
  ) {
    this.panel = panel;
    this.solver = createSolver({
      core: this.core,
      sketch: () => this.s,
      status: (text, error) => this.host.status(text, error),
      setDof: (dof) => (this.dof = dof),
      failed: () => this.failed,
      setFailed: (failed) => (this.failed = failed),
      render: () => renderSketch(this),
      refreshProfiles: () => refreshProfiles(this),
      refreshFreedom: () => refreshFreedom(this),
    });
    window.addEventListener("keydown", this.onTyping, true);
    // A bare press of Alt toggles construction on the selected curves (Alt with a click or another key does not).
    window.addEventListener("keydown", (e) => this.altPress.down(e.key, e.repeat), true);
    window.addEventListener("pointerdown", () => this.altPress.spoil(), true);
    window.addEventListener("wheel", () => this.altPress.spoil(), true);
    window.addEventListener("keyup", (e) => {
      if (!this.altPress.up(e.key) || !this.active || this.settingsDialog?.open || this.leaveDialog?.open || (e.target as HTMLElement).closest("input, select, textarea")) return;
      e.preventDefault(); // so the browser's menu does not take the focus
      toggleConstruction(this);
    }, true);
    window.addEventListener("pointermove", (e) => (this.lastPointer = { x: e.clientX, y: e.clientY }), true);
    window.addEventListener("resize", () => { if (this.active) placePanel(this); });
    for (const o of [this.normal, this.placed, this.construction, this.points]) o.userData.extent = true; // counted by the origin axes' length
    for (const o of [this.axes, this.normal, this.placed, this.construction, this.free, this.marked, this.pending, this.centres, this.points]) {
      o.renderOrder = 5;
      o.frustumCulled = false;
      this.group.add(o);
    }
    this.axes.renderOrder = 4; // the sketch axes are drawn over the grid (order 1) and under the sketch shapes (5)
    this.construction.renderOrder = 4.5; // construction curves are dashed and always under the normal curves (5), over the axes
    this.points.renderOrder = 6; // the points, the origin among them, are drawn over every curve
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
      if (this.chain.length) endChain(this);
      if (still && this.tool !== "select") this.setTool("select");
    });
  }

  // Entering and leaving ----------------------------------------------------------------------------

  /** Set while sketching on an unrolled cylinder face: the face the regions are wrapped back onto when finishing. */
  unwrapFace: number[] | null = null;

  /** A kept sketch being edited: its id and name in the document; null for a new sketch. */
  kept: { id: number; name: string } | null = null;
  /** Called with the id of the kept sketch being edited, or null when none is, so the sketch list can hide its copy of it. */
  onEditing: ((id: number | null) => void) | null = null;

  start(plane: M.PlaneData, reference?: { points: M.SketchPoint[]; entities: M.SketchEntity[] }, unwrapFace: number[] | null = null, distortion?: { max: number; note: string }, kept?: { id: number; name: string; sketch: any }) {
    if (this.active && needsConfirm(this)) {
      // Starting another sketch would throw this one away: ask first.
      void confirmLeave(this).then(async (choice) => {
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
    if (this.unwrapFace === null) {
      // The sketch origin is the center of the face (or the plane's origin): a fixed point to snap to and constrain against; every flat sketch has it, a kept one too.
      if (!this.s.points.some((p) => Math.hypot(p.u, p.v) < 1e-6)) this.s.points.push({ id: M.nextId(this.s), u: 0, v: 0, fixed: true });
      if (!kept) for (const o of M.originPoints(plane, this.s.points)) this.s.points.push({ id: M.nextId(this.s), u: o.u, v: o.v, fixed: true });
    }
    const f = M.frame(this.s.plane);
    this.plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(...f.n), new THREE.Vector3(...f.origin));
    this.tool = "select";
    this.lastDrawTool = null;
    this.selection = [];
    this.selectedDimensions.clear();
    this.chain = [];
    this.dof = null;
    this.failed.clear();
    this.freedom.clear();
    this.freeSizes.clear();
    this.showFree = false;
    this.undoStack = [];
    this.active = true;
    this.viewport.selectItems([]); // the model's selection highlight would cover the sketch
    this.viewport.onSelect([]); // and the selection itself ends: no face, edge or body stays selected behind the sketch
    this.viewport.manipulator.clear(); // so would the selected face's push/pull arrow
    this.planeBase = null;
    showPlaneHandles(this);
    buildGrid(this, f);
    this.viewport.scene.add(this.group);
    this.viewport.interceptor = { down: (e) => onDown(this, e), move: (e) => onMove(this, e), up: (e) => onUp(this, e) };
    this.viewport.onFrame2 = () => onFrame(this);
    const mode = this;
    this.viewport.fitSource = { all: () => F.fitPointsAll(this.s), selected: () => F.fitPointsSelected(this.s, this.selection), get pad() { return F.dimensionPad(mode.s); } }; // the nav cube's zoom to fit uses the sketch
    renderSketch(this);
    if (kept) void refreshProfiles(this);
    this.onToolChange?.();
    if (!kept && this.options.lookAtNew) this.viewport.lookFromOrthographic(new THREE.Vector3(...f.n));
    this.host.status(distortion ? distortion.note : "Sketch: choose a drawing tool in the top bar (Line, Rectangle, Circle, Arc)", !!distortion);
  }

  leaveDialog: HTMLDialogElement | null = null;

  exit() {
    if (!this.active) return;
    this.active = false;
    this.valueField?.remove();
    this.profileSeq++;
    setProfiles(this, []);
    cancelBox(this);
    this.viewport.interceptor = null;
    this.viewport.onFrame2 = null;
    this.viewport.fitSource = null;
    this.viewport.manipulator.clear();
    if (this.projectPick !== null) cancelProjectPick(this, true);
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
  planeBase: M.PlaneData | null = null;
  /** While picking what to project: the faces and edges chosen so far (null when not picking). */
  projectPick: Sel[] | null = null;
  /** Whether the plane's move and turn gizmos are drawn (the header's gizmo button). */
  gizmosShown = false;
  /** The base point picked for moving the plane (null until picked). */
  moveFrom: number[] | null = null;

  onPlaneDrag(param: string, value: number, phase: "move" | "end" | "cancel"): boolean {
    return onPlaneDrag(this, param, value, phase);
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
  snap(e: PointerEvent): Snap | null {
    return Sn.snap(this, e);
  }
  pick(e: PointerEvent): M.SketchSel | null {
    return Sn.pick(this, e);
  }

  /** The box being dragged on empty space (client pixels); window = left to right, crossing = right to left, as in the 3D view. */
  box: { x0: number; y0: number; x1: number; y1: number; active: boolean; additive: boolean } | null = null;
  boxEl: HTMLDivElement | null = null;

  /** The selection a box made (compared by identity: any later change replaces it). */
  boxSelection: M.SketchSel[] | null = null;

  /** A press on an item that was already selected: a click without movement removes it from the selection. */
  clickToggle: { sel: M.SketchSel; x: number; y: number } | null = null;

  /** Keys typed while drawing (captured before the key router sees them). Digits (or an opening bracket) start the entry, Tab or space moves to the next number, Enter applies, Backspace edits, Escape clears. */
  private onTyping = (e: KeyboardEvent) => {
    const labels = typedLabels(this);
    if (!labels.length || e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).closest("input, select, textarea")) return;
    const next = T.typedKey(this.typed, e.key, labels.length);
    if (next !== null) this.typed = next;
    else if (e.key === "Enter" && this.typed) void applyTyped(this);
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (this.typed) {
      const field = Math.min(labels.length - 1, this.typed.trim().split(/\s+/).length - (this.typed.endsWith(" ") ? 0 : 1));
      this.host.status(`Typing the ${labels[field]}: ${this.typed}| (${labels.length > 1 ? `${labels.join(", ")}; Tab for the next number, ` : ""}Enter places it)`);
    }
    renderSketch(this);
  };
  typed = "";
  /** True while typed sizes place their points: a typed arc sweep is always counterclockwise. */
  placingTyped = false;

  onKey(e: KeyboardEvent) {
    return onKey(this, e);
  }

  // Editing -----------------------------------------------------------------------------------------

  pushUndo() {
    return pushUndo(this);
  }

  redoStack: string[] = [];

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  step(kind: "undo" | "redo") {
    return undoStep(this, kind);
  }

  /** The id of an existing or new point for a clicked position. */
  pointFor(snap: Snap): number {
    if (snap.id !== undefined) return snap.id;
    const id = M.nextId(this.s);
    this.s.points.push({ id, u: snap.u, v: snap.v });
    snap.id = id;
    if (snap.on) this.addConstraintRaw(snap.on.midpoint ? { type: "midpoint", point: id, entity: snap.on.entity } : { type: "point_on", point: id, entity: snap.on.entity }, "snap");
    // A point clicked on a sketch axis (both of them at the origin) is held on it.
    for (const k of snap.axes ?? []) this.addConstraintRaw({ type: "point_on", point: id, entity: k === 0 ? M.AXIS_U : M.AXIS_V, axisHold: true }, "snap");
    return id;
  }

  /** A constraint a drawing tool adds on its own: "snap" ones follow from where you clicked, "shape" ones keep a rectangle, polygon or slot its shape. Whether either is added is the sketch option `auto`. */
  addConstraintRaw(c: Omit<M.SketchConstraint, "id">, kind: "snap" | "shape" | "always" = "shape") {
    if (kind !== "always" && (this.options.auto === "none" || (this.options.auto === "snaps" && kind === "shape"))) return;
    this.s.constraints.push({ id: M.nextId(this.s), ...c, auto: true }); // every caller is a drawing tool, not the user
  }

  // Drawing tools: the work is in sketchbuilders.ts, which takes this mode as its context.
  chainStart?: Snap;
  /** The first curve picked for a Fillet or Chamfer between two curves that need not touch. */
  cornerFirst: number | null = null;
  /** Curves picked so far for the Tangent circle and Arc tangent to curves tools. */
  tanPicks: number[] = [];
  rectOptions: { corner: "none" | "fillet" | "chamfer"; size: number } = { corner: "none", size: 5 };
  /** Numbers of the arc tools kept in the sketch card (start angle and sweep of the center arc, radius of the arc by ends and radius). */
  arcOptions = defaultArcOptions();
  status(text: string, error?: boolean | "warn") {
    this.host.status(text, error);
  }
  addLine(a: Snap, b: Snap): boolean {
    return B.addLine(this, a, b);
  }
  addRectangle(a: Snap, b: Snap, centred = false) {
    B.addRectangle(this, a, b, centred);
  }
  addPolygon(center: Snap, corner: Snap, sides: number) {
    B.addPolygon(this, center, corner, sides);
  }
  addCircle(center: Snap, edge: Snap) {
    B.addCircle(this, center, edge);
  }
  addEllipseArc(center: Snap, major: Snap, side: Snap, start: Snap, end: Snap) {
    B.addEllipseArc(this, center, major, side, start, end, this.placingTyped);
  }

  addEllipse(center: Snap, major: Snap, side: Snap) {
    B.addEllipse(this, center, major, side);
  }
  addSpline(closed: boolean) {
    B.addSpline(this, closed);
  }
  addArcThrough(start: Snap, through: Snap, end: Snap) {
    B.addArcThrough(this, start, through, end);
  }
  addCircleThrough(a: Snap, b: Snap, c: Snap) {
    B.addCircleThrough(this, a, b, c);
  }
  addSlot(a: Snap, b: Snap, side: Snap) {
    B.addSlot(this, a, b, side);
  }
  addArc(center: Snap, start: Snap, end: Snap) {
    B.addArc(this, center, start, end, this.placingTyped || this.arcOptions.sweep !== null);
  }

  /** The drawing tool used last in this sketch; Enter with no tool active starts it again. */
  lastDrawTool: Tool | null = null;
  /** Lines the Trim tool has marked for removal; a second click on one deletes it. */
  trimCandidates = new Set<number>();

  setTool(tool: Tool) {
    if (tool !== "select") this.lastDrawTool = tool;
    if (tool !== "select") usage.record(`sketch_${tool}`.toLowerCase().replace(/[^a-z0-9_]/g, "_"), "start", "other");
    this.trimCandidates.clear();
    if (this.cornerFirst !== null) this.selection = [];
    this.cornerFirst = null;
    if (this.tanPicks.length) this.selection = [];
    this.tanPicks = [];
    this.tool = tool;
    this.typed = "";
    this.chain = [];
    this.chainStart = undefined;
    this.cursor = null;
    this.hover = null;
    this.onToolChange?.();
    this.host.status(`Sketch ${SKETCH_TOOLS.find((t) => t.id === tool)!.label}: ${SKETCH_TOOLS.find((t) => t.id === tool)!.hint}`);
    renderSketch(this);
  }

  constraintChoices(): { label: string; enabled: boolean }[] {
    return constraintChoices(this);
  }

  chooseConstraint(label: string) {
    return chooseConstraint(this, label);
  }

  /** Where the pointer last was on the page (client pixels): the smart dimension's menu opens there. */
  lastPointer = { x: 200, y: 200 };

  /** The sketch settings window (the gear in the sketch card): grid spacing and automatic constraints. Changes apply at once and are remembered on this computer. */
  openSettings() {
    if (this.settingsDialog?.open) return;
    this.settingsDialog = openSketchSettings(this.options, { save: () => this.saveOptions(), rebuildGrid: () => buildGrid(this), closed: () => (this.settingsDialog = null) });
  }

  /** Run `then` once the dimensions have been drawn (the overlay redraws every frame). */
  afterDraw(then: () => void) {
    requestAnimationFrame(() => requestAnimationFrame(then));
  }

  valueField: HTMLElement | null = null;

  async editDimension(id: number) {
    return editDimension(this, id);
  }

  /** Dimensions picked in the view (a click on a dimension's value; Shift or Ctrl adds), for the right-click menu to switch several at once. */
  selectedDimensions = new Set<number>();

  async toggleReference(id: number) {
    return toggleReference(this, id);
  }

  async setReference(ids: number[], reference: boolean) {
    return setReference(this, ids, reference);
  }

  /** Ask for a dimension's value; ticking "Reference" keeps the current measurement instead of driving the shape. */
  /** Several numbers at once (and optionally a Copy box) in the ask strip. Resolves null when cancelled. */
  askForm(title: string, fields: { label: string; value: number; integer?: boolean }[], copy?: boolean): Promise<{ values: number[]; copy: boolean } | null> {
    return askForm(this.panel, title, fields, copy);
  }

  askNumber(label: string, initial: number): Promise<{ value: number; reference: boolean } | null> {
    return askNumber(this.panel, label, initial);
  }

  // Solving -----------------------------------------------------------------------------------------

  resolve(drag?: Drag): Promise<boolean> {
    return resolveSketch(this, drag);
  }

  freedomSeq = 0;

  profileFills: THREE.Mesh[] = [];
  profileSeq = 0;

  profileData: { positions: number[]; indices: number[] }[] = [];
  triangleCache: { data: unknown; key: string; triangles: number[][][] } | null = null;

  draggedDimension: number | null = null;


  offset = { distance: 5 };

  private readonly altPress = new BareAltPress();

  // Drawing -----------------------------------------------------------------------------------------

  lightUp(c: M.SketchConstraint | null) {
    return lightUp(this, c);
  }

  render(panel = true) {
    return renderSketch(this, panel);
  }

  // Panel -------------------------------------------------------------------------------------------

}
