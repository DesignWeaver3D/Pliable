import * as THREE from "three";
import { viewPlane, type ViewPlane } from "./viewplane.ts";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { Mark } from "./viewportmark.ts";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { CentreInfo, MeshData } from "./client.ts";
import { DepthProbe } from "./occlusion.ts";
import { Manipulator } from "./manipulator.ts";
import { PullGizmo } from "./pullgizmo.ts";
import { PullDirection, edgeVector, type Vec } from "./pulldir.ts";
import { PushPullState } from "./pushpullstate.ts";
import { MirrorArrow } from "./pushpullarrows.ts";
import { SubtractGhost } from "./subtractghost.ts";
import type { HandleInfo } from "./tools.ts";
import { onSettingsChange, settings, updateSettings } from "./settings.ts";
import { bodyColorArray } from "./bodycolorarray.ts";
import { PERSPECTIVE_FOV, alignToFace, fitClipping, lookFrom, lookFromOrthographic, returnFromSketchView, setOrthographic, setView, syncOrtho, viewMatrixCss } from "./viewcamera.ts";
import { fitAll, fitSelected, frame as frameBox } from "./viewfit.ts";
import { faceUnder, pickModelItem } from "./viewpick.ts";
import { updateFilterBadge } from "./viewboxselect.ts";
import { applyBodyColors, applyGhost, applySeeThrough, syncSectionClip } from "./viewlook.ts";
import { slideBodies } from "./viewslide.ts";
import { refreshCentres, selectItems, setHover, setRelated } from "./viewselection.ts";
import { toggleMeasure, toggleMeasureKey } from "./viewdragmeasure.ts";
import { cancelDrag, finishDrag } from "./viewitemdrag.ts";
import { wireInput } from "./viewinput.ts";

/** A "body" selection is a whole solid (every face of the body), chosen from the body list. An "axis" is a global axis (id 0, 1, 2 for X, Y, Z) picked in the view. */
export type Kind = "face" | "edge" | "vertex" | "body" | "axis";
export interface Sel {
  kind: Kind;
  id: number;
  /** A face selection made through the hole's center dot: the same hole for every tool, shown as the dot alone (no tint on the wall). */
  centre?: boolean;
}

export interface Hit extends Sel {
  point: THREE.Vector3;
  /** Surface normal at the point (faces only), pointing out of the solid. */
  surfaceNormal?: THREE.Vector3;
}

/** A straight edge parallel to the dragged face's normal with one end on the face: its length changes as the face moves. */
export interface Measure {
  fixed: THREE.Vector3; // end that stays put
  anchor: THREE.Vector3; // end on the face, before the drag
  length: number;
  /** +1 if pulling the face outward lengthens the edge, -1 if it shortens it. */
  grow: 1 | -1;
}

export class Viewport {
  readonly scene = new THREE.Scene();
  readonly perspectiveCamera = new THREE.PerspectiveCamera(PERSPECTIVE_FOV, 1, 0.1, 10000);
  readonly orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10000);
  /** The active camera (a true orthographic camera in orthographic mode, not a narrow-FOV perspective one). */
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.perspectiveCamera;
  /** Half the visible height at zoom 1 of the orthographic camera, in world units. */
  orthoHalf = 1;
  readonly keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
  aspect = 1;
  readonly renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  controls: OrbitControls;
  lastClip = 0;
  model = new THREE.Group();
  mesh: THREE.Mesh | null = null;
  edgeLines: THREE.LineSegments | null = null;
  /** Bodies drawn apart from the rest so they can be slid on the client while a move handle is dragged (see `slideBodies`). */
  moving: { bodies: Set<number>; surface: THREE.Mesh; edges: THREE.LineSegments; data: MeshData } | null = null;
  data: MeshData | null = null;
  faceStarts: number[] = [];
  surfaceMaterial: THREE.MeshPhysicalMaterial | null = null;
  /** Look of the see-through bodies (the surface material, translucent); they are drawn as separate index ranges of the same geometry. */
  ghostMaterial: THREE.MeshPhysicalMaterial | null = null;
  ghosted: ReadonlySet<number> = new Set();
  readonly hemiLight = new THREE.HemisphereLight(0xffffff, 0x445566, 1.4);
  /** Soft studio environment for the glossy look, built once on first use. */
  studioEnv: THREE.Texture | null = null;
  edgeMaterial: THREE.LineBasicMaterial | null = null;
  hovered: Sel | null = null;
  /** Hole centers currently shown: those of the hovered or selected hole faces and the centers of circular edges. */
  centresShown: CentreInfo[] = [];
  centreDots: THREE.Points | null = null;
  selected: Sel[] = [];
  markSource: THREE.BufferGeometry | null = null;
  selectedMarks: Mark[] = [];
  hoverMark: Mark | null = null;
  relatedMarks: Mark[] = [];
  hoverLine = new LineMaterial({ color: 0xffd36b, linewidth: 3, depthTest: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  /** Half-length of the drawn global axes (0 while they are hidden): the reference view sets it, and the axes can be picked along it. */
  originAxisHalf = 0;
  selectedLine = new LineMaterial({ color: 0xff8a1f, linewidth: 4, depthTest: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  raycaster = new THREE.Raycaster();
  /** Box selection in progress (screen coordinates); active once the pointer moved past the click threshold. */
  box: { x0: number; y0: number; x1: number; y1: number; active: boolean; additive: boolean } | null = null;
  boxEl: HTMLDivElement | null = null;
  /** Kind of item a box drag selects while F (faces), E (edges) or V (vertices) is held; null when no key is held. */
  heldKind: Kind | null = null;
  filterBadge: HTMLDivElement | null = null;
  rightDown: { x: number; y: number } | null = null;
  similarMenu: HTMLDivElement | null = null;
  /** Last see-through click, so clicking the same spot again picks the next face behind. */
  lastClick = { x: -99, y: -99, n: 0 };
  drag: { sels: Sel[]; normal: THREE.Vector3; point: THREE.Vector3; x: number; y: number; moved: boolean } | null = null;
  /** Called when the user changes the selection by clicking. */
  onSelect: (selection: Sel[]) => void = () => {};
  /** A tool card is open: pressing another item then only picks it (the card ignores that), it does not start that item's drag tool. */
  toolOpen: () => boolean = () => false;
  /** The tinted profile regions of kept sketches that a click can pick as if they were faces (they belong to no model). */
  profileTargets: () => { id: number; region: number; object: THREE.Object3D }[] = () => [];
  onProfileClick: (sketchId: number, region: number, additive: boolean) => void = () => {};
  /** The tinted region under the pointer (null for none), and a double-click on a sketch's curves or regions (its id). */
  onProfileHover: (at: { id: number; region: number } | null, curve: number | null) => void = () => {};
  onSketchDouble: (sketchId: number) => void = () => {};
  /** Shift or Ctrl+click on a kept sketch's curve: the sketch is chosen (or let go) as a path or snap source beside the selection. */
  onSketchCurveClick: (sketchId: number) => void = () => {};
  /** The drawn curves of the kept sketches, for the double-click to find the sketch under the pointer. */
  curveTargets: () => { id: number; object: THREE.LineSegments }[] = () => [];
  /** Double-click on an edge: the host selects the whole smooth chain it belongs to (Ctrl adds to the selection). */
  onEdgeLoop: (edgeId: number, additive: boolean) => void = () => {};
  /** Double-click on a face: select its whole body (same as clicking its row in the body list). */
  onFaceBody: (bodyId: number) => void = () => {};
  /** Dragging a selected face or edge drives its tool on the whole selection. distance is in model units along the dragged item's outward direction. */
  onItemDrag: (sels: Sel[], distance: number, phase: "move" | "end" | "cancel", x?: number, y?: number) => void = () => {};
  /** Whether this handle of the selection starts the selection's tool drag (set by main.ts: the drag tool's own value handle). */
  handleStartsItemDrag: (info: HandleInfo) => boolean = () => false;
  /** While true (typed value entry or measure mode), pointer movement does not change the drag distance. */
  holdDrag = false;
  /** Set when the button was let go while a typed value held the drag; Escape then cancels instead of resuming the mouse. */
  dragReleased = false;
  /** While set, the next click picks an item for this callback instead of selecting it (eyedropper). */
  eyedropper: ((sel: Sel) => void) | null = null;
  onEyedropCancel: () => void = () => {};
  /** Dragging a hole center moves the hole in the plane across its axis; offset is in model units. */
  onCentreDrag: (face: number, offset: THREE.Vector3, phase: "start" | "move" | "end" | "cancel") => void = () => {};
  /** While the Divide face form is open: pressing and dragging over the model places the dividing line (see startDivideDrag). */
  divideFrame: { face: number; centre: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3; normal: THREE.Vector3 } | null = null;
  onDivideDrag: (across: number, offset: number, done: boolean) => void = () => {};
  divideDrag: { plane: THREE.Plane; x: number; y: number; start: THREE.Vector3; across: number | null; offset: number } | null = null;
  centreDrag: { face: number; origin: THREE.Vector3; plane: THREE.Plane; start: THREE.Vector3; x: number; y: number; moved: boolean } | null = null;
  /** Measurable edges of the dragged face (empty unless a single planar face is dragged). */
  measures: Measure[] = [];
  /** The measurement nearest where the drag started; shown as context in the dimension label. */
  primaryMeasure: Measure | null = null;
  /** Measure mode (right-click during a drag): the user edits an edge length instead of the drag distance. */
  measureMode = false;
  measureSel: Measure | null = null;
  /** Called when measure mode, or the chosen measurement, changes. */
  onMeasureChange: () => void = () => {};
  measureHover: Measure | null = null;
  lastDistance = 0;
  measureAll = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: 0x4fc3f7, linewidth: 2, depthTest: false }));
  measureHot = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: 0xffffff, linewidth: 4, depthTest: false }));

  /** Called after every rendered frame (the dimension overlay redraws here). */
  onFrame: () => void = () => {};
  /** A second per-frame hook, owned by sketch mode. */
  onFrame2: (() => void) | null = null;

  /** The handles a tool declares for its parameters, drawn over the model and dragged with the left button. */
  readonly manipulator: Manipulator;
  /** The push/pull direction (see pulldir.ts) and the gizmo that sets it. */
  readonly pullDirection = new PullDirection();
  /** What the Push/Pull card chose: mode, flip, symmetric, and the Alt override (pushpullstate.ts). */
  readonly pushPull = new PushPullState();
  readonly pullGizmo: PullGizmo;
  /** The red arrow opposite the push/pull arrow: the subtract direction. */
  private readonly mirrorArrow: MirrorArrow;
  /** The translucent red solid of a subtract preview through empty space (subtractghost.ts). */
  readonly subtractGhost: SubtractGhost;

  /** While set (sketch mode), left-button pointer events go here instead of selection and tool drags. */
  interceptor: { down(e: PointerEvent): void; move(e: PointerEvent): void; up(e: PointerEvent): void } | null = null;

  /** The point where the pointer's ray meets a plane, or null if it misses (parallel or behind the camera). */
  planePoint(e: PointerEvent, plane: THREE.Plane): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    return this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  }

  /** The model's mesh data (null before the first model arrives). */
  get meshData(): MeshData | null {
    return this.data;
  }

  faceUnder(e: PointerEvent): { id: number; point: THREE.Vector3 } | null {
    return faceUnder(this, e);
  }

  /** Screen position (CSS pixels, relative to the viewport element) of a world point. */
  toScreen(p: THREE.Vector3): THREE.Vector2 {
    return this.toPixels(p, this.renderer.domElement.getBoundingClientRect());
  }

  /** The plane square to the camera through the point it orbits (see viewplane.ts), for a sketch "on the screen". */
  viewPlane(): ViewPlane {
    this.camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    return viewPlane(this.camera.position.toArray(), this.controls.target.toArray(), right.toArray());
  }

  /** World length of one screen pixel at a point (for snapping and handle sizes). */
  pixelSizeAt(p: THREE.Vector3): number {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return this.pixelSizeAtDistance(p.distanceTo(this.camera.position), rect.height);
  }

  /** World length of one screen pixel for something `distance` from the camera (the same everywhere when orthographic). */
  pixelSizeAtDistance(distance: number, height: number): number {
    if (this.camera instanceof THREE.OrthographicCamera) return (2 * this.orthoHalf) / this.camera.zoom / height;
    return (2 * distance * Math.tan((this.camera.fov * Math.PI) / 360)) / height;
  }

  lookFrom(direction: THREE.Vector3) {
    return lookFrom(this, direction);
  }

  /** Whether a tool drag has moved past the click threshold. */
  get dragging(): boolean {
    return this.drag?.moved ?? false;
  }

  cancelDrag() {
    return cancelDrag(this);
  }

  finishDrag() {
    return finishDrag(this);
  }

  toPixels(p: THREE.Vector3, rect: DOMRect) {
    const n = p.clone().project(this.camera);
    return new THREE.Vector2(((n.x + 1) / 2) * rect.width, ((1 - n.y) / 2) * rect.height);
  }

  toggleMeasureKey(): string | null {
    return toggleMeasureKey(this);
  }

  /** Leaves measure mode and returns to the plain drag (one Escape level). */
  exitMeasure() {
    if (this.measureMode) toggleMeasure(this);
  }

  constructor(container: HTMLElement) {
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.localClippingEnabled = true; // the section view clips the model's own materials only, not the gizmos
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x1b1d22);
    this.scene.add(this.model);
    this.scene.add(this.hemiLight);
    this.keyLight.position.set(1, 2, 3);
    for (const c of [this.perspectiveCamera, this.orthoCamera]) c.up.set(0, 0, 1);
    this.camera.add(this.keyLight);
    this.scene.add(this.camera);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener("change", () => returnFromSketchView(this));
    // Navigation: left selects (and drags tools), right orbits,
    // middle pans, the wheel zooms toward the cursor.
    this.controls.mouseButtons = { LEFT: null as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.zoomToCursor = true;
    const dom = this.renderer.domElement;
    this.manipulator = new Manipulator(this.scene, () => this.camera, dom, (p) => this.pixelSizeAt(p));
    this.subtractGhost = new SubtractGhost(this.scene);
    this.mirrorArrow = new MirrorArrow(this.scene, (p) => this.pixelSizeAt(p), this.manipulator, this.pushPull);
    this.pullGizmo = new PullGizmo(this.scene, () => this.camera, dom, (p) => this.pixelSizeAt(p), this.manipulator, this.pullDirection);
    wireInput(this);
    for (const line of [this.measureAll, this.measureHot]) {
      line.visible = false;
      line.renderOrder = 3;
      this.scene.add(line);
    }
    window.addEventListener("resize", () => this.resize());
    onSettingsChange(() => {
      applySeeThrough(this);
      applyBodyColors(this);
      updateFilterBadge(this);
    });
    updateFilterBadge(this);
    this.resize();
    // A frame that throws must not end the loop (three.js stops calling it after a throw, which left the view blank): each part is guarded.
    const parts: [string, () => void][] = [
      ["controls", () => this.controls.update()],
      ["clipping", () => fitClipping(this)],
      ["section clip", () => syncSectionClip(this)],
      ["render", () => this.renderer.render(this.scene, this.camera)],
      ["manipulator", () => this.manipulator.update()],
      ["subtract arrow", () => this.mirrorArrow.update()],
      ["pull gizmo", () => this.pullGizmo.update()],
      ["frame hook", () => this.onFrame()],
      ["sketch frame hook", () => this.onFrame2?.()],
    ];
    this.renderer.setAnimationLoop(() => {
      for (const [name, part] of parts) {
        try {
          part();
        } catch (e) {
          this.reportFrameError(name, e);
        }
      }
    });
    const canvas = this.renderer.domElement;
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault(); // lets the browser give the context back
      this.reportFrameError("WebGL context", new Error("The 3D view lost its graphics context; waiting for it to return"));
    });
    canvas.addEventListener("webglcontextrestored", () => this.onFrameError("The 3D view recovered"));
  }

  /** Called with a message when a part of the frame fails (shown in the status line); the console gets each kind once. */
  onFrameError: (message: string) => void = () => {};
  private reportedFrameErrors = new Set<string>();

  private reportFrameError(part: string, e: unknown) {
    const message = (e as Error)?.message ?? String(e);
    const key = `${part}: ${message}`;
    if (this.reportedFrameErrors.has(key)) return; // a failure repeating every frame is reported once
    this.reportedFrameErrors.add(key);
    console.error(`Pliable 3D view: ${part} failed (drawing continues):`, e);
    this.onFrameError(`3D view ${part} failed: ${message}`);
  }

  get orthographic(): boolean {
    return this.camera === this.orthoCamera;
  }

  setOrthographic(on: boolean) {
    return setOrthographic(this, on);
  }

  /** Set while a sketch view switched to orthographic: the view direction it looked along, to go back to perspective when the camera is turned away. */
  sketchViewReturn: THREE.Vector3 | null = null;
  /** The projection changed (the nav cube's button follows it). */
  onProjectionChange: () => void = () => {};

  lookFromOrthographic(direction: THREE.Vector3) {
    return lookFromOrthographic(this, direction);
  }

  setView(name: string) {
    return setView(this, name);
  }

  alignToFace(faceId: number): boolean {
    return alignToFace(this, faceId);
  }

  viewMatrixCss(): string {
    return viewMatrixCss(this);
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.renderer.domElement.parentElement!;
    this.renderer.setSize(w, h);
    this.aspect = w / h;
    this.perspectiveCamera.aspect = this.aspect;
    this.perspectiveCamera.updateProjectionMatrix();
    syncOrtho(this);
    this.hoverLine.resolution.set(w, h);
    this.selectedLine.resolution.set(w, h);
    this.measureAll.material.resolution.set(w, h);
    this.measureHot.material.resolution.set(w, h);
  }

  setMesh(mesh: MeshData, frame: boolean) {
    for (const child of [...this.model.children]) {
      this.model.remove(child);
      (child as THREE.Mesh).geometry?.dispose();
    }
    this.hovered = null;
    this.onHoverBody(null);
    this.selected = [];
    this.centresShown = [];
    this.selectedMarks = [];
    this.relatedMarks = [];
    this.data = mesh;
    this.faceStarts = mesh.faces.map((f) => f.start / 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geometry.setAttribute("color", new THREE.BufferAttribute(bodyColorArray(mesh), 3));
    const material = new THREE.MeshPhysicalMaterial({
      color: 0x9db4cc,
      metalness: 0.1,
      roughness: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.model.add(this.mesh);
    this.surfaceMaterial = material;
    this.ghostMaterial = new THREE.MeshPhysicalMaterial();
    applyBodyColors(this);
    applyGhost(this);
    this.hoverMark = new Mark(this.model, geometry, 0xffd36b, 0.55, this.hoverLine);
    this.markSource = geometry;

    const edges = new THREE.BufferGeometry();
    edges.setAttribute("position", new THREE.BufferAttribute(mesh.edgePositions, 3));
    this.edgeMaterial = new THREE.LineBasicMaterial({ color: 0x111418 });
    this.edgeLines = new THREE.LineSegments(edges, this.edgeMaterial);
    this.model.add(this.edgeLines);
    this.moving = null;
    // Hole center dots are drawn only for the hovered or selected hole (see refreshCentres).
    this.centreDots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0x4fc3f7, size: 7, sizeAttenuation: false, depthTest: false }));
    this.centreDots.renderOrder = 3;
    this.model.add(this.centreDots);
    refreshCentres(this);
    applySeeThrough(this);

    if (frame) frameBox(this, mesh.bounds.every((n) => n === 0) ? [-50, -50, 0, 50, 50, 50] : mesh.bounds); // an empty project looks at the origin from a useful distance
    this.onMeshSet();
  }

  /** Called after a new mesh is shown (the section view redraws its cut). */
  onMeshSet: () => void = () => {};

  sectionClip: THREE.Plane[] | null = null;

  /** Cut the model away on the negative side of the plane (null shows it whole). Only the model's own surfaces and edges are clipped. */
  setSectionClip(plane: THREE.Plane | null) {
    this.sectionClip = plane ? [plane] : null;
  }

  slideBodies(bodies: Set<number>, offset: [number, number, number]) {
    return slideBodies(this, bodies, offset);
  }

  /** The bodies drawn see-through (view only). Solid bodies inside them stay visible; their faces never hide picks behind them. */
  /** Hide (or show again) every gizmo, so none is in the way of a point pick. */
  setGizmosHidden(hidden: boolean) {
    this.manipulator.hidden = this.pullGizmo.hidden = this.mirrorArrow.hidden = hidden;
  }

  setGhosted(ids: ReadonlySet<number>) {
    this.ghosted = ids;
    applyGhost(this);
  }

  toggleSeeThrough() {
    updateSettings({ seeThrough: !settings.seeThrough });
  }

  /** The depth picture a box select tests its points against (null outside one). */
  probe: DepthProbe | null = null;

  /** The direction a picked edge (its straight line) or face (its normal) gives, or null for a curved edge or an unknown item. */
  directionOf(sel: Sel): Vec | null {
    const data = this.data;
    if (!data) return null;
    if (sel.kind === "face") return data.faces.find((f) => f.id === sel.id)?.normal ?? null;
    if (sel.kind !== "edge") return null;
    const edge = data.edges.find((e) => e.id === sel.id);
    if (!edge || edge.count !== 2) return null;
    const at = (i: number): Vec => [data.edgePositions[i * 3], data.edgePositions[i * 3 + 1], data.edgePositions[i * 3 + 2]];
    return edgeVector(at(edge.start), at(edge.start + 1));
  }

  pickModelItem(e: PointerEvent): Sel | null {
    return pickModelItem(this, e);
  }

  /** World points of the hole and circle centers currently shown, for use as snap targets. */
  get shownCentres(): THREE.Vector3[] {
    return this.centresShown.map((c) => new THREE.Vector3(...c.position));
  }

  /** The pointer is over (or left) a body: its id, so the host can light up the body's row in the list. */
  onHoverBody: (id: number | null) => void = () => {};

  /** Hover highlight set from outside (a row of the body list). */
  hoverItem(sel: Sel | null) {
    setHover(this, sel);
  }

  setRelated(sels: Sel[]) {
    return setRelated(this, sels);
  }

  selectItems(sels: Sel[]) {
    return selectItems(this, sels);
  }

  /** While a sketch is open the zoom-to-fit buttons use the sketch's geometry: the world points to fit (all of it, or the selection), null when it has none. */
  fitSource: { all(): number[][] | null; selected(): number[][] | null; /** Screen pixels of room to leave around the fitted points (dimension text and lines). */ pad?: number } | null = null;

  /** Pixels at each edge of the view that overlays cover (the top toolbar): the zoom-to-fit buttons fit inside what is left. */
  fitInsets: (() => { top: number; right: number; bottom: number; left: number }) | null = null;

  fitAll() {
    return fitAll(this);
  }

  fitSelected(): boolean {
    return fitSelected(this);
  }

}
