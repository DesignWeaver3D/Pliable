import { pointInRect, segmentHitsRect, segmentsInBox, triangleHitsRect, trianglesInBox, type Rect } from "./boxselect";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { CentreInfo, MeshData } from "./client";
import { onSettingsChange, settings, updateSettings } from "./settings";

export type Kind = "face" | "edge" | "vertex";
export interface Sel {
  kind: Kind;
  id: number;
}

interface Hit extends Sel {
  point: THREE.Vector3;
}

const EDGE_TIE_PX = 2; // edges this close on screen are told apart by depth
const CENTRE_HANDLE_PX = 7; // pressing this close to a hole centre dot starts moving the hole
const MEASURE_PICK_PX = 10; // pick radius for measurement edges in measure mode
const MEASURE_TOL = 1e-3; // model units: on-plane / parallel tolerance when finding measurable edges

/** A straight edge parallel to the dragged face's normal with one end on the face: its length changes as the face moves. */
export interface Measure {
  fixed: THREE.Vector3; // end that stays put
  anchor: THREE.Vector3; // end on the face, before the drag
  length: number;
  /** +1 if pulling the face outward lengthens the edge, -1 if it shortens it. */
  grow: 1 | -1;
}

/** A highlight of one face, edge or vertex, drawn over the model. */
class Mark {
  readonly face: THREE.Mesh;
  readonly edge: LineSegments2;
  readonly vertex: THREE.Points;

  constructor(parent: THREE.Object3D, source: THREE.BufferGeometry, color: number, opacity: number, readonly lineMaterial: LineMaterial) {
    const faceGeometry = new THREE.BufferGeometry();
    faceGeometry.setAttribute("position", source.getAttribute("position"));
    faceGeometry.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1));
    this.face = new THREE.Mesh(
      faceGeometry,
      new THREE.MeshBasicMaterial({
        color,
        opacity,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    this.edge = new LineSegments2(new LineSegmentsGeometry(), lineMaterial);
    this.vertex = new THREE.Points(
      new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3)),
      new THREE.PointsMaterial({ color, size: 11, sizeAttenuation: false, depthTest: false }),
    );
    for (const object of [this.face, this.edge, this.vertex]) {
      object.visible = false;
      object.renderOrder = 2;
      parent.add(object);
    }
  }

  hide() {
    this.face.visible = this.edge.visible = this.vertex.visible = false;
  }
}

const PERSPECTIVE_FOV = 45;
const ISO_DIRECTION = new THREE.Vector3(1, -1.4, 0.9).normalize(); // from the target toward the camera

/** Standard views, numbered (0 isometric, 1 front, 2 top, 3 right, 4 rear, 5 bottom, 6 left); Z is up. */
export const STANDARD_VIEWS: Record<string, THREE.Vector3> = {
  iso: ISO_DIRECTION,
  front: new THREE.Vector3(0, -1, 0),
  top: new THREE.Vector3(0, -1e-4, 1).normalize(), // tilted a hair so "up" on screen stays defined
  right: new THREE.Vector3(1, 0, 0),
  rear: new THREE.Vector3(0, 1, 0),
  bottom: new THREE.Vector3(0, -1e-4, -1).normalize(),
  left: new THREE.Vector3(-1, 0, 0),
};

export class Viewport {
  readonly scene = new THREE.Scene();
  private readonly perspectiveCamera = new THREE.PerspectiveCamera(PERSPECTIVE_FOV, 1, 0.1, 10000);
  private readonly orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10000);
  /** The active camera (a true orthographic camera in orthographic mode, not a narrow-FOV perspective one). */
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.perspectiveCamera;
  /** Half the visible height at zoom 1 of the orthographic camera, in world units. */
  private orthoHalf = 1;
  private readonly keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
  private aspect = 1;
  readonly renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  private controls: OrbitControls;
  private lastClip = 0;
  private model = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private data: MeshData | null = null;
  private faceStarts: number[] = [];
  private surfaceMaterial: THREE.MeshStandardMaterial | null = null;
  private edgeMaterial: THREE.LineBasicMaterial | null = null;
  private hovered: Sel | null = null;
  /** Hole centres currently shown: those of the hovered or selected hole faces and the centres of circular edges. */
  private centresShown: CentreInfo[] = [];
  private centreDots: THREE.Points | null = null;
  private selected: Sel[] = [];
  private markSource: THREE.BufferGeometry | null = null;
  private selectedMarks: Mark[] = [];
  private hoverMark: Mark | null = null;
  private relatedMarks: Mark[] = [];
  private hoverLine = new LineMaterial({ color: 0xffd36b, linewidth: 3, depthTest: true });
  private selectedLine = new LineMaterial({ color: 0xff8a1f, linewidth: 4, depthTest: true });
  private raycaster = new THREE.Raycaster();
  /** Box selection in progress (screen coordinates); active once the pointer moved past the click threshold. */
  private box: { x0: number; y0: number; x1: number; y1: number; active: boolean; additive: boolean } | null = null;
  private boxEl: HTMLDivElement | null = null;
  /** Last see-through click, so clicking the same spot again picks the next face behind. */
  private lastClick = { x: -99, y: -99, n: 0 };
  private drag: { sels: Sel[]; normal: THREE.Vector3; point: THREE.Vector3; x: number; y: number; moved: boolean } | null = null;
  /** Called when the user changes the selection by clicking. */
  onSelect: (selection: Sel[]) => void = () => {};
  /** Double-click on an edge: the host selects the whole smooth chain it belongs to (Ctrl adds to the selection). */
  onEdgeLoop: (edgeId: number, additive: boolean) => void = () => {};
  /** Dragging a selected face or edge drives its tool on the whole selection. distance is in model units along the dragged item's outward direction. */
  onItemDrag: (sels: Sel[], distance: number, phase: "move" | "end" | "cancel", x?: number, y?: number) => void = () => {};
  /** While true (typed value entry or measure mode), pointer movement does not change the drag distance. */
  holdDrag = false;
  /** While set, the next click picks an item for this callback instead of selecting it (eyedropper). */
  eyedropper: ((sel: Sel) => void) | null = null;
  onEyedropCancel: () => void = () => {};
  /** Dragging a hole centre moves the hole in the plane across its axis; offset is in model units. */
  onCentreDrag: (face: number, offset: THREE.Vector3, phase: "start" | "move" | "end" | "cancel") => void = () => {};
  /** While the Divide face form is open: pressing and dragging over the model places the dividing line (see startDivideDrag). */
  divideFrame: { face: number; centre: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3; normal: THREE.Vector3 } | null = null;
  onDivideDrag: (across: number, offset: number, done: boolean) => void = () => {};
  private divideDrag: { plane: THREE.Plane; x: number; y: number; start: THREE.Vector3; across: number | null; offset: number } | null = null;
  private centreDrag: { face: number; origin: THREE.Vector3; plane: THREE.Plane; start: THREE.Vector3; x: number; y: number; moved: boolean } | null = null;
  /** Measurable edges of the dragged face (empty unless a single planar face is dragged). */
  measures: Measure[] = [];
  /** The measurement nearest where the drag started; shown as context in the dimension label. */
  primaryMeasure: Measure | null = null;
  /** Measure mode (right-click during a drag): the user edits an edge length instead of the drag distance. */
  measureMode = false;
  measureSel: Measure | null = null;
  /** Called when measure mode, or the chosen measurement, changes. */
  onMeasureChange: () => void = () => {};
  private measureHover: Measure | null = null;
  private lastDistance = 0;
  private measureAll = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: 0x4fc3f7, linewidth: 2, depthTest: false }));
  private measureHot = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: 0xffffff, linewidth: 4, depthTest: false }));

  /** Called after every rendered frame (the dimension overlay redraws here). */
  onFrame: () => void = () => {};
  /** A second per-frame hook, owned by sketch mode. */
  onFrame2: (() => void) | null = null;

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

  /** Face under the pointer and the point where the ray meets it, ignoring edges and vertices (used by snapping). */
  faceUnder(e: PointerEvent): { id: number; point: THREE.Vector3 } | null {
    if (!this.mesh || !this.data) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    const hit = this.raycaster.intersectObject(this.mesh)[0];
    if (!hit || hit.faceIndex == null) return null;
    let lo = 0;
    let hi = this.faceStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.faceStarts[mid] <= hit.faceIndex) lo = mid;
      else hi = mid - 1;
    }
    const face = this.data.faces[lo];
    return face && face.count > 0 ? { id: face.id, point: hit.point } : null;
  }

  /** Screen position (CSS pixels, relative to the viewport element) of a world point. */
  toScreen(p: THREE.Vector3): THREE.Vector2 {
    return this.toPixels(p, this.renderer.domElement.getBoundingClientRect());
  }

  /** World length of one screen pixel at a point (for snapping and handle sizes). */
  pixelSizeAt(p: THREE.Vector3): number {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return this.pixelSizeAtDistance(p.distanceTo(this.camera.position), rect.height);
  }

  /** World length of one screen pixel for something `distance` from the camera (the same everywhere when orthographic). */
  private pixelSizeAtDistance(distance: number, height: number): number {
    if (this.camera instanceof THREE.OrthographicCamera) return (2 * this.orthoHalf) / this.camera.zoom / height;
    return (2 * distance * Math.tan((this.camera.fov * Math.PI) / 360)) / height;
  }

  /** Size the orthographic frustum to the viewport's aspect ratio. */
  private syncOrtho() {
    const c = this.orthoCamera;
    c.top = this.orthoHalf;
    c.bottom = -this.orthoHalf;
    c.right = this.orthoHalf * this.aspect;
    c.left = -c.right;
    c.updateProjectionMatrix();
  }

  /** Look straight down a direction (from the side it points to), keeping target and distance. */
  lookFrom(direction: THREE.Vector3) {
    const d = direction.clone().normalize();
    if (Math.abs(d.z) > 0.9999) d.y -= 1e-4; // keep "up" defined
    d.normalize();
    const distance = this.camera.position.distanceTo(this.controls.target);
    this.camera.position.copy(this.controls.target).addScaledVector(d, distance);
    this.controls.update();
  }

  /** Whether a tool drag has moved past the click threshold. */
  get dragging(): boolean {
    return this.drag?.moved ?? false;
  }

  /** Cancels the current drag, even while a typed value holds it (the window lost focus). */
  cancelDrag() {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.holdDrag = false;
    this.controls.enabled = true;
    this.endMeasure();
    this.onItemDrag(drag.sels, 0, "cancel");
  }

  /** Ends the current drag as if the pointer was released (used when a typed value is committed); later pointer events are ignored. */
  finishDrag() {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.holdDrag = false;
    this.controls.enabled = true;
    this.onItemDrag(drag.sels, 0, "end"); // reads measureSel synchronously, so clear it afterwards
    this.endMeasure();
  }

  private toPixels(p: THREE.Vector3, rect: DOMRect) {
    const n = p.clone().project(this.camera);
    return new THREE.Vector2(((n.x + 1) / 2) * rect.width, ((1 - n.y) / 2) * rect.height);
  }

  /** Straight edges parallel to the face normal with exactly one end on the face (and inside it). */
  private findMeasures(sel: Sel, normal: THREE.Vector3, point: THREE.Vector3): Measure[] {
    const data = this.data;
    const range = sel.kind === "face" ? data?.faces.find((f) => f.id === sel.id) : undefined;
    if (!data || !this.mesh || !range) return [];
    const position = this.mesh.geometry.getAttribute("position");
    const index = this.mesh.geometry.getIndex()!.array;
    const triangles: THREE.Triangle[] = [];
    for (let i = range.start; i < range.start + range.count; i += 3) {
      triangles.push(
        new THREE.Triangle(
          new THREE.Vector3().fromBufferAttribute(position, index[i]),
          new THREE.Vector3().fromBufferAttribute(position, index[i + 1]),
          new THREE.Vector3().fromBufferAttribute(position, index[i + 2]),
        ),
      );
    }
    const onFace = (p: THREE.Vector3) => triangles.some((t) => t.closestPointToPoint(p, new THREE.Vector3()).distanceTo(p) < MEASURE_TOL);
    const out: Measure[] = [];
    for (const edge of data.edges) {
      if (edge.count !== 2) continue;
      const a = new THREE.Vector3().fromArray(data.edgePositions, edge.start * 3);
      const b = new THREE.Vector3().fromArray(data.edgePositions, (edge.start + 1) * 3);
      const length = a.distanceTo(b);
      if (length < MEASURE_TOL || Math.abs(b.clone().sub(a).dot(normal)) < length * (1 - 1e-6)) continue;
      const da = a.clone().sub(point).dot(normal);
      const db = b.clone().sub(point).dot(normal);
      const aOn = Math.abs(da) < MEASURE_TOL;
      const bOn = Math.abs(db) < MEASURE_TOL;
      if (aOn === bOn) continue;
      const [anchor, fixed, otherSide] = aOn ? [a, b, db] : [b, a, da];
      if (onFace(anchor)) out.push({ fixed, anchor, length, grow: otherSide < 0 ? 1 : -1 });
    }
    return out;
  }

  private drawMeasures(distance: number) {
    this.lastDistance = distance;
    const normal = this.drag?.normal ?? new THREE.Vector3();
    const segments = (list: Measure[]) =>
      list.flatMap((m) => [...m.fixed.toArray(), ...m.anchor.clone().addScaledVector(normal, distance).toArray()]);
    const hot = this.measureSel ?? this.measureHover ?? this.primaryMeasure;
    this.measureAll.visible = this.measureMode && this.measures.length > 0;
    if (this.measureAll.visible) this.measureAll.geometry.setPositions(segments(this.measures));
    this.measureHot.visible = hot !== null;
    if (hot) this.measureHot.geometry.setPositions(segments([hot]));
  }

  private endMeasure() {
    this.measureMode = false;
    this.measureSel = this.measureHover = this.primaryMeasure = null;
    this.measures = [];
    this.measureAll.visible = this.measureHot.visible = false;
  }

  private nearestMeasure(e: PointerEvent): Measure | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const n = this.drag?.normal;
    if (!n) return null;
    const pointer = new THREE.Vector2(e.clientX - rect.left, e.clientY - rect.top);
    let best: Measure | null = null;
    let bestDistance = MEASURE_PICK_PX;
    this.camera.updateMatrixWorld();
    for (const m of this.measures) {
      const a = this.toPixels(m.fixed, rect);
      const b = this.toPixels(m.anchor.clone().addScaledVector(n, this.lastDistance), rect);
      const ab = b.clone().sub(a);
      const t = ab.lengthSq() === 0 ? 0 : Math.max(0, Math.min(1, pointer.clone().sub(a).dot(ab) / ab.lengthSq()));
      const d = a.add(ab.multiplyScalar(t)).distanceTo(pointer);
      if (d < bestDistance) {
        bestDistance = d;
        best = m;
      }
    }
    return best;
  }

  private toggleMeasure() {
    if (this.measureMode) {
      this.measureMode = false;
      this.holdDrag = false;
      this.measureSel = null;
    } else if (this.measures.length > 0) {
      this.measureMode = true;
      this.holdDrag = true;
      this.measureSel = this.primaryMeasure ?? this.measures[0];
    } else return;
    this.drawMeasures(this.lastDistance);
    this.onMeasureChange();
  }

  /** Leaves measure mode and returns to the plain drag (one Escape level). */
  exitMeasure() {
    if (this.measureMode) this.toggleMeasure();
  }

  constructor(container: HTMLElement) {
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x1b1d22);
    this.scene.add(this.model);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.4));
    this.keyLight.position.set(1, 2, 3);
    for (const c of [this.perspectiveCamera, this.orthoCamera]) c.up.set(0, 0, 1);
    this.camera.add(this.keyLight);
    this.scene.add(this.camera);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    // Navigation: left selects (and drags tools), right orbits,
    // middle pans, the wheel zooms toward the cursor.
    this.controls.mouseButtons = { LEFT: null as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.zoomToCursor = true;
    const dom = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    dom.addEventListener("pointerdown", (e) => {
      if (this.interceptor && e.button === 0) {
        this.interceptor.down(e);
        return;
      }
      down = { x: e.clientX, y: e.clientY };
      if (e.button !== 0 || this.measureMode || this.eyedropper) return;
      if (this.startCentreDrag(e) || this.startDivideDrag(e)) return;
      const hit = this.pickHit(e);
      this.box = null;
      const direction = hit && this.dragDirection(hit);
      // Dragging the selected face or edge starts its tool instead of orbiting.
      const additive = e.ctrlKey || e.metaKey || e.shiftKey;
      if (hit && direction && !additive) {
        // Pressing on an item selects it and starts its tool drag in one motion.
        if (!this.isSelected(hit)) {
          const sel = { kind: hit.kind, id: hit.id };
          this.selectItems([sel]);
          this.onSelect([sel]);
        }
        this.drag = { sels: [...this.selected], normal: direction, point: hit.point, x: e.clientX, y: e.clientY, moved: false };
        this.measures = this.drag.sels.length === 1 && hit.kind === "face" ? this.findMeasures(this.drag.sels[0], direction, hit.point) : [];
        this.primaryMeasure = this.measures.reduce<Measure | null>(
          (best, m) => (best === null || m.anchor.distanceTo(hit.point) < best.anchor.distanceTo(hit.point) ? m : best),
          null,
        );
        this.drawMeasures(0);
        // Controls stay enabled: the left button is unmapped, so right-drag orbits and
        // middle-drag pans while the tool drag continues.
        dom.setPointerCapture(e.pointerId);
      } else {
        // Not starting a tool: a drag from here is a box selection.
        this.box = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, active: false, additive };
        dom.setPointerCapture(e.pointerId);
      }
    });
    dom.addEventListener("pointermove", (e) => {
      if (this.divideDrag) {
        this.moveDivideDrag(e);
        return;
      }
      if (this.centreDrag) {
        this.moveCentreDrag(e);
        return;
      }
      if (this.box) {
        this.updateBox(e);
        return;
      }
      if (this.interceptor) {
        this.interceptor.move(e);
        return;
      }
      if (this.drag) {
        if (this.measureMode) {
          this.measureHover = this.nearestMeasure(e);
          this.drawMeasures(this.lastDistance);
        }
        if (this.holdDrag) return;
        const distance = this.dragDistance(e);
        if (this.drag.moved || Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) >= 4) {
          this.drag.moved = true;
          this.drawMeasures(distance);
          this.onItemDrag(this.drag.sels, distance, "move", e.clientX, e.clientY);
        }
      } else if (e.buttons === 0) this.setHover(this.pick(e));
    });
    dom.addEventListener("contextmenu", (e) => e.preventDefault());
    for (const line of [this.measureAll, this.measureHot]) {
      line.visible = false;
      line.renderOrder = 3;
      this.scene.add(line);
    }
    dom.addEventListener("pointerleave", () => this.setHover(null));
    dom.addEventListener("dblclick", (e) => {
      if (this.interceptor) return;
      const hit = this.pickHit(e as PointerEvent);
      if (hit?.kind === "edge") this.onEdgeLoop(hit.id, e.ctrlKey || e.metaKey);
    });
    dom.addEventListener("pointerup", (e) => {
      if (this.interceptor && e.button === 0) {
        this.interceptor.up(e);
        return;
      }
      if (this.drag && e.button !== 0) return; // right/middle release ends an orbit or pan, not the tool drag
      const drag = this.drag;
      if (this.divideDrag && e.button === 0) {
        const d = this.divideDrag;
        this.divideDrag = null;
        if (d.across !== null) this.onDivideDrag(d.across, d.offset, true);
        down = null;
        return;
      }
      if (this.centreDrag && e.button === 0) {
        const c = this.centreDrag;
        this.centreDrag = null;
        if (c.moved) {
          this.onCentreDrag(c.face, this.centreOffset(e, c), "end");
          down = null;
        } else {
          this.clickSelect({ kind: "face", id: c.face }, e.ctrlKey || e.metaKey || e.shiftKey);
          down = null;
        }
        return;
      }
      if (this.eyedropper && e.button === 0) {
        const sel = this.pick(e);
        if (sel) this.eyedropper(sel);
        down = null;
        return;
      }
      if (this.box) {
        this.finishBox(e);
        down = null;
        return;
      }
      if (drag && this.measureMode) {
        // Measure mode keeps the drag open: a click picks the edge to edit.
        const picked = this.nearestMeasure(e);
        if (picked && picked !== this.measureSel) {
          this.measureSel = picked;
          this.drawMeasures(this.lastDistance);
          this.onMeasureChange();
        }
        down = null;
        return;
      }
      if (drag) {
        this.endMeasure();
        this.drag = null;
        this.holdDrag = false;
        if (drag.moved) {
          this.onItemDrag(drag.sels, this.dragDistance(e, drag), "end");
          down = null;
          return;
        }
      }
      // A click, not the end of an orbit/pan drag.
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4 && e.button === 0) {
        this.clickSelect(this.pickCycling(e), e.ctrlKey || e.metaKey || e.shiftKey);
      }
      down = null;
    });
    window.addEventListener("keydown", (e) => {
      // M during a tool drag toggles measure mode (it used to be the right button, which now orbits).
      if ((e.key === "m" || e.key === "M") && this.drag?.moved && !e.ctrlKey && !e.metaKey && !e.altKey) this.toggleMeasure();
      if (e.key === "Escape" && this.box) this.cancelBox();
      if (e.key === "Escape" && this.divideDrag) this.divideDrag = null;
      if (e.key === "Escape" && this.centreDrag) {
        const c = this.centreDrag;
        this.centreDrag = null;
        if (c.moved) this.onCentreDrag(c.face, new THREE.Vector3(), "cancel");
      }
      if (e.key === "Escape" && this.eyedropper) this.onEyedropCancel();
      if (e.key === "Escape" && this.drag && !this.holdDrag) {
        const sels = this.drag.sels;
        this.drag = null;
        this.holdDrag = false;
        this.endMeasure();
        this.onItemDrag(sels, 0, "cancel");
      }
    });
    window.addEventListener("resize", () => this.resize());
    onSettingsChange(() => this.applySeeThrough());
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.fitClipping();
      this.renderer.render(this.scene, this.camera);
      this.onFrame();
      this.onFrame2?.();
    });
  }

  get orthographic(): boolean {
    return this.camera === this.orthoCamera;
  }

  /** Switch between perspective and orthographic, keeping what is framed the same size. */
  setOrthographic(on: boolean) {
    if (on === this.orthographic) return;
    const target = this.controls.target;
    const from = this.camera;
    const to = on ? this.orthoCamera : this.perspectiveCamera;
    const tan = Math.tan((PERSPECTIVE_FOV * Math.PI) / 360);
    const distance = from.position.distanceTo(target);
    if (on) {
      this.orthoHalf = distance * tan; // what the perspective view shows at the target
      this.orthoCamera.zoom = 1;
      this.syncOrtho();
    } else {
      this.perspectiveCamera.position.copy(target).addScaledVector(from.position.clone().sub(target).normalize(), this.orthoHalf / this.orthoCamera.zoom / tan);
    }
    if (on) to.position.copy(from.position);
    to.quaternion.copy(from.quaternion);
    from.remove(this.keyLight);
    this.scene.remove(from);
    to.add(this.keyLight);
    this.scene.add(to);
    this.camera = to;
    this.controls.object = to;
    this.lastClip = 0;
    this.fitClipping(true);
    this.controls.update();
  }

  /** Look at the model from a standard direction (a key of STANDARD_VIEWS), keeping target and distance. */
  setView(name: string) {
    const direction = STANDARD_VIEWS[name];
    if (!direction) return;
    const distance = this.camera.position.distanceTo(this.controls.target);
    this.camera.position.copy(this.controls.target).addScaledVector(direction, distance);
    this.controls.update();
  }

  /** Look straight at a planar face, from the side its normal points to. Returns false if the face is not planar. */
  alignToFace(faceId: number): boolean {
    const face = this.data?.faces.find((f) => f.id === faceId);
    if (!face) return false;
    const direction = face.normal ? new THREE.Vector3(...face.normal) : this.averageFaceDirection(face);
    if (!direction) return false;
    if (Math.abs(direction.z) > 0.9999) direction.y -= 1e-4; // keep "up" defined
    direction.normalize();
    const distance = this.camera.position.distanceTo(this.controls.target);
    this.camera.position.copy(this.controls.target).addScaledVector(direction, distance);
    this.controls.update();
    return true;
  }

  /**
   * View direction for a non-planar face: the area-weighted mean of its triangle normals (cylinder, cone, sphere, freeform).
   * Faces that wrap around (full cylinder) average to nothing, so they use the direction from the model centre to the face centre.
   */
  private averageFaceDirection(range: { start: number; count: number }): THREE.Vector3 | null {
    if (!this.mesh) return null;
    const position = this.mesh.geometry.getAttribute("position");
    const index = this.mesh.geometry.getIndex()!.array;
    const sum = new THREE.Vector3();
    const centre = new THREE.Vector3();
    const [a, b, c, n] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    let area = 0;
    for (let i = range.start; i < range.start + range.count; i += 3) {
      a.fromBufferAttribute(position, index[i]);
      b.fromBufferAttribute(position, index[i + 1]);
      c.fromBufferAttribute(position, index[i + 2]);
      n.crossVectors(b.clone().sub(a), c.clone().sub(a)).multiplyScalar(0.5); // length = triangle area
      sum.add(n);
      area += n.length();
      centre.addScaledVector(a.clone().add(b).add(c), n.length() / 3);
    }
    if (area === 0) return null;
    if (sum.length() > area * 0.1) return sum; // normalised by the caller
    const axis = this.wrapAxis(range);
    if (axis) {
      // Look along the axis from the side the camera is already on.
      const toCamera = this.camera.position.clone().sub(this.controls.target);
      return toCamera.dot(axis) < 0 ? axis.negate() : axis;
    }
    centre.divideScalar(area);
    this.mesh.geometry.computeBoundingBox();
    const outward = centre.sub(this.mesh.geometry.boundingBox!.getCenter(new THREE.Vector3()));
    return outward.length() > 1e-9 ? outward : null;
  }

  /**
   * Axis of a cylinder- or cone-like face: the direction every triangle normal is perpendicular to. The area-weighted
   * covariance of the normals has rank 2 there, so its null vector is the cross product of two of its rows.
   * Returns null when the normals span all three directions (sphere, torus, freeform).
   */
  private wrapAxis(range: { start: number; count: number }): THREE.Vector3 | null {
    const position = this.mesh!.geometry.getAttribute("position");
    const index = this.mesh!.geometry.getIndex()!.array;
    const [a, b, c, n] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const m = new THREE.Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0);
    let area = 0;
    for (let i = range.start; i < range.start + range.count; i += 3) {
      a.fromBufferAttribute(position, index[i]);
      b.fromBufferAttribute(position, index[i + 1]);
      c.fromBufferAttribute(position, index[i + 2]);
      n.crossVectors(b.clone().sub(a), c.clone().sub(a));
      const w = n.length() / 2;
      if (w === 0) continue;
      n.normalize();
      const v = [n.x, n.y, n.z];
      for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) m.elements[k * 3 + r] += w * v[r] * v[k];
      area += w;
    }
    if (area === 0) return null;
    const rows = [0, 1, 2].map((r) => new THREE.Vector3(m.elements[r], m.elements[3 + r], m.elements[6 + r]).divideScalar(area));
    let best: THREE.Vector3 | null = null;
    for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
      const axis = rows[i].clone().cross(rows[j]);
      if (!best || axis.length() > best.length()) best = axis;
    }
    if (!best || best.length() < 1e-6) return null;
    best.normalize();
    // The axis is only valid if the normals really are perpendicular to it (mean squared cosine near zero).
    const perp = rows.reduce((s, row) => s + Math.abs(row.dot(best!)), 0);
    return perp < 0.05 ? best : null;
  }

  /** Near and far planes follow the camera distance (it changes a lot between perspective and orthographic). */
  private fitClipping(force = false) {
    const distance = this.camera.position.distanceTo(this.controls.target);
    if (!force && Math.abs(distance - this.lastClip) < this.lastClip * 0.01) return;
    this.lastClip = distance;
    this.camera.near = distance / 100;
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
  }

  /** CSS matrix3d string for a cube drawn in the camera's orientation (see navcube.ts). */
  viewMatrixCss(): string {
    this.camera.updateMatrixWorld();
    const e = this.camera.matrixWorldInverse.elements; // column-major, world to camera
    // css-local (x right, y down, z toward viewer) -> world (x, -z, -y) -> camera -> css (flip y)
    const r = (row: number, col: number) => e[col * 4 + row];
    // Camera-space image of each css-local axis.
    const cols = [
      [r(0, 0), -r(1, 0), r(2, 0)], // css x -> world X
      [-r(0, 2), r(1, 2), -r(2, 2)], // css y (down) -> world -Z
      [-r(0, 1), r(1, 1), -r(2, 1)], // css z (toward viewer) -> world -Y
    ];
    const m = [...cols[0], 0, ...cols[1], 0, ...cols[2], 0, 0, 0, 0, 1];
    return `matrix3d(${m.join(",")})`;
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.renderer.domElement.parentElement!;
    this.renderer.setSize(w, h);
    this.aspect = w / h;
    this.perspectiveCamera.aspect = this.aspect;
    this.perspectiveCamera.updateProjectionMatrix();
    this.syncOrtho();
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
    const material = new THREE.MeshStandardMaterial({
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
    this.hoverMark = new Mark(this.model, geometry, 0xffd36b, 0.55, this.hoverLine);
    this.markSource = geometry;

    const edges = new THREE.BufferGeometry();
    edges.setAttribute("position", new THREE.BufferAttribute(mesh.edgePositions, 3));
    this.edgeMaterial = new THREE.LineBasicMaterial({ color: 0x111418 });
    this.model.add(new THREE.LineSegments(edges, this.edgeMaterial));
    // Hole centre dots are drawn only for the hovered or selected hole (see refreshCentres).
    this.centreDots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0x4fc3f7, size: 7, sizeAttenuation: false, depthTest: false }));
    this.centreDots.renderOrder = 3;
    this.model.add(this.centreDots);
    this.refreshCentres();
    this.applySeeThrough();

    if (frame) this.frame(mesh.bounds);
  }

  private show(mark: Mark | null, sel: Sel | null) {
    if (!mark || !this.mesh || !this.data) return;
    mark.hide();
    if (!sel) return;
    if (sel.kind === "face") {
      const range = this.data.faces.find((f) => f.id === sel.id);
      if (!range) return;
      const source = this.mesh.geometry.getIndex()!.array as Uint32Array;
      mark.face.geometry.setIndex(new THREE.BufferAttribute(source.subarray(range.start, range.start + range.count), 1));
      mark.face.visible = true;
    } else if (sel.kind === "edge") {
      const range = this.data.edges.find((e) => e.id === sel.id);
      if (!range || range.count === 0) return;
      const positions = this.data.edgePositions.subarray(range.start * 3, (range.start + range.count) * 3);
      mark.edge.geometry.setPositions(positions);
      mark.edge.visible = true;
    } else {
      const vertex = this.data.vertices.find((v) => v.id === sel.id);
      if (!vertex) return;
      mark.vertex.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vertex.position), 3));
      mark.vertex.visible = true;
    }
  }

  /** A click pick; in see-through mode clicking the same spot again goes to the next face behind the previous one. */
  private pickCycling(e: PointerEvent): Sel | null {
    const through = settings.seeThrough || e.altKey; // Alt+click cycles through hidden faces without see-through
    const hit = this.pickHit(e);
    const same = Math.hypot(e.clientX - this.lastClick.x, e.clientY - this.lastClick.y) < 3;
    if (!through || !hit || hit.kind !== "face") {
      this.lastClick = { x: e.clientX, y: e.clientY, n: 0 };
      return hit && { kind: hit.kind, id: hit.id };
    }
    const faces = this.facesUnder(e);
    const n = same && faces.length ? (this.lastClick.n + 1) % faces.length : 0;
    this.lastClick = { x: e.clientX, y: e.clientY, n };
    return faces.length ? { kind: "face", id: faces[n] } : { kind: hit.kind, id: hit.id };
  }

  /** Ids of every face the ray under the pointer passes through, nearest first. */
  private facesUnder(e: PointerEvent): number[] {
    if (!this.mesh || !this.data) return [];
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(
      new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1),
      this.camera,
    );
    const ids: number[] = [];
    // The ray test skips back-facing triangles unless the material is double sided, which would hide every face behind the first.
    const material = this.mesh.material as THREE.Material;
    const side = material.side;
    material.side = THREE.DoubleSide;
    const hits = this.raycaster.intersectObject(this.mesh);
    material.side = side;
    for (const hit of hits) {
      if (hit.faceIndex == null) continue;
      const id = this.faceIdAt(hit.faceIndex);
      if (id !== null && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  private faceIdAt(triangle: number): number | null {
    let lo = 0;
    let hi = this.faceStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.faceStarts[mid] <= triangle) lo = mid;
      else hi = mid - 1;
    }
    const face = this.data!.faces[lo];
    return face && face.count > 0 ? face.id : null;
  }

  /** See-through: the surface is drawn translucent and edges ignore depth so hidden ones can be seen and picked. */
  private applySeeThrough() {
    const on = settings.seeThrough;
    if (this.surfaceMaterial) {
      this.surfaceMaterial.transparent = on;
      this.surfaceMaterial.opacity = on ? 0.12 : 1; // faces nearly clear; the edges carry the shape
      this.surfaceMaterial.depthWrite = !on;
      this.surfaceMaterial.needsUpdate = true;
    }
    if (this.edgeMaterial) {
      this.edgeMaterial.depthTest = !on;
      this.edgeMaterial.color.set(on ? 0xdce6f2 : 0x111418); // light edges stand out on the dark background through clear faces
    }
    this.hoverLine.depthTest = this.selectedLine.depthTest = !on;
  }

  toggleSeeThrough() {
    updateSettings({ seeThrough: !settings.seeThrough });
  }

  private updateBox(e: PointerEvent) {
    const b = this.box!;
    b.x1 = e.clientX;
    b.y1 = e.clientY;
    if (!b.active && Math.hypot(b.x1 - b.x0, b.y1 - b.y0) < 4) return;
    b.active = true;
    if (!this.boxEl) {
      this.boxEl = document.createElement("div");
      this.boxEl.style.cssText = "position:fixed;pointer-events:none;z-index:2;border:1px solid #4fc3f7;background:rgba(79,195,247,0.12)";
      document.body.appendChild(this.boxEl);
    }
    const crossing = b.x1 < b.x0;
    this.boxEl.style.left = Math.min(b.x0, b.x1) + "px";
    this.boxEl.style.top = Math.min(b.y0, b.y1) + "px";
    this.boxEl.style.width = Math.abs(b.x1 - b.x0) + "px";
    this.boxEl.style.height = Math.abs(b.y1 - b.y0) + "px";
    this.boxEl.style.borderStyle = crossing ? "dashed" : "solid"; // dashed = crossing, solid = window
    this.boxEl.style.borderColor = crossing ? "#8bc34a" : "#4fc3f7";
  }

  private cancelBox() {
    this.box = null;
    this.boxEl?.remove();
    this.boxEl = null;
  }

  private finishBox(e: PointerEvent) {
    const b = this.box!;
    this.cancelBox();
    if (!b.active) {
      // Plain click on empty space or a ctrl-click: ordinary pick.
      this.clickSelect(this.pickCycling(e), b.additive);
      return;
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    const r = {
      x0: Math.min(b.x0, b.x1) - rect.left,
      x1: Math.max(b.x0, b.x1) - rect.left,
      y0: Math.min(b.y0, b.y1) - rect.top,
      y1: Math.max(b.y0, b.y1) - rect.top,
    };
    const crossing = b.x1 < b.x0; // right-to-left touches; left-to-right must enclose
    const kind: Kind = settings.boxKind === "auto" ? (this.selected[0]?.kind ?? "edge") : settings.boxKind;
    const found = this.itemsInBox(kind, r, crossing, rect);
    let next = found;
    if (b.additive) {
      const same = this.selected.filter((s) => s.kind === kind);
      next = [...same, ...found.filter((f) => !same.some((s) => s.id === f.id))];
    }
    this.selectItems(next);
    this.onSelect(next);
  }

  /** Whether a world point is hidden behind the model (never, in see-through mode). */
  private occluded(p: THREE.Vector3): boolean {
    if (settings.seeThrough || !this.mesh) return false;
    const dir = p.clone().sub(this.camera.position);
    const distance = dir.length();
    this.raycaster.set(this.camera.position, dir.normalize());
    const hit = this.raycaster.intersectObject(this.mesh)[0];
    return !!hit && hit.distance < distance * 0.995;
  }

  private itemsInBox(kind: Kind, r: Rect, crossing: boolean, rect: DOMRect): Sel[] {
    const data = this.data;
    if (!data) return [];
    this.camera.updateMatrixWorld();
    const out: Sel[] = [];
    const proj = (x: number, y: number, z: number) => {
      const n = new THREE.Vector3(x, y, z).project(this.camera);
      return { x: ((n.x + 1) / 2) * rect.width, y: ((1 - n.y) / 2) * rect.height, behind: n.z > 1 };
    };
    /** An item is visible if any of a few sample points on it (spread along it) is not behind the model. */
    const anyVisible = (samples: THREE.Vector3[]) => samples.some((p) => !this.occluded(p));
    const spread = <T,>(items: T[], n: number): T[] => {
      if (items.length <= n) return items;
      return Array.from({ length: n }, (_, i) => items[Math.floor(((i + 0.5) * items.length) / n)]);
    };
    if (kind === "vertex") {
      for (const v of data.vertices) {
        const q = proj(v.position[0], v.position[1], v.position[2]);
        if (!q.behind && pointInRect(q, r) && !this.occluded(new THREE.Vector3(v.position[0], v.position[1], v.position[2]))) out.push({ kind, id: v.id });
      }
    } else if (kind === "edge") {
      const ep = data.edgePositions;
      for (const edge of data.edges) {
        if (edge.count === 0) continue;
        const pts: Array<{ x: number; y: number }> = [];
        let behind = false;
        for (let i = edge.start; i < edge.start + edge.count; i++) {
          const q = proj(ep[i * 3], ep[i * 3 + 1], ep[i * 3 + 2]);
          if (q.behind) behind = true;
          pts.push(q);
        }
        if (behind || !segmentsInBox(pts, r, crossing)) continue;
        // Sample the middle of each segment that is inside or touches the box.
        const samples: THREE.Vector3[] = [];
        for (let i = 0; i + 1 < edge.count; i += 2) {
          if (!(crossing ? segmentHitsRect(pts[i], pts[i + 1], r) : true)) continue;
          const a = (edge.start + i) * 3;
          const b = (edge.start + i + 1) * 3;
          samples.push(new THREE.Vector3((ep[a] + ep[b]) / 2, (ep[a + 1] + ep[b + 1]) / 2, (ep[a + 2] + ep[b + 2]) / 2));
        }
        if (anyVisible(spread(samples, 6))) out.push({ kind, id: edge.id });
      }
    } else {
      const pos = data.positions;
      const idx = data.indices;
      for (const face of data.faces) {
        if (face.count === 0) continue;
        const pts: Array<{ x: number; y: number }> = [];
        let behind = false;
        for (let i = face.start; i < face.start + face.count; i++) {
          const v = idx[i] * 3;
          const q = proj(pos[v], pos[v + 1], pos[v + 2]);
          if (q.behind) behind = true;
          pts.push(q);
        }
        if (behind || !trianglesInBox(pts, r, crossing)) continue;
        // Sample the centre of each triangle that is inside or overlaps the box.
        const samples: THREE.Vector3[] = [];
        for (let i = 0; i + 2 < face.count; i += 3) {
          if (crossing && !triangleHitsRect(pts[i], pts[i + 1], pts[i + 2], r)) continue;
          const c = new THREE.Vector3();
          for (let k = 0; k < 3; k++) {
            const v = idx[face.start + i + k] * 3;
            c.add(new THREE.Vector3(pos[v], pos[v + 1], pos[v + 2]));
          }
          samples.push(c.multiplyScalar(1 / 3));
        }
        if (anyVisible(spread(samples, 12))) out.push({ kind, id: face.id });
      }
    }
    return out;
  }

  private pick(e: PointerEvent): Sel | null {
    const hit = this.pickHit(e);
    return hit && { kind: hit.kind, id: hit.id };
  }

  /** Axis a picked item is dragged along (faces: normal, edges: outward bisector), or null if it has none. */
  private dragDirection(hit: Hit): THREE.Vector3 | null {
    const normal =
      hit.kind === "face"
        ? this.data?.faces.find((f) => f.id === hit.id)?.normal
        : hit.kind === "edge"
          ? this.data?.edges.find((e) => e.id === hit.id)?.normal
          : null;
    return normal ? new THREE.Vector3(...normal) : null;
  }

  /** Distance along the dragged item's axis implied by the pointer position. */
  private dragDistance(e: PointerEvent, drag = this.drag!): number {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const toPixels = (p: THREE.Vector3) => {
      const n = p.clone().project(this.camera);
      return new THREE.Vector2(((n.x + 1) / 2) * rect.width, ((1 - n.y) / 2) * rect.height);
    };
    const length = this.camera.position.distanceTo(drag.point) * 0.25;
    const p0 = toPixels(drag.point);
    let axis = toPixels(drag.point.clone().addScaledVector(drag.normal, length)).sub(p0);
    if (axis.length() < 2) axis = new THREE.Vector2(0, -100); // looking along the normal
    const delta = new THREE.Vector2(e.clientX - drag.x, e.clientY - drag.y);
    return Math.round((delta.dot(axis) / axis.lengthSq()) * length * 1000) / 1000;
  }

  /** What is under the pointer: a vertex, else an edge, else a face (vertices and edges only if not hidden behind a face). */
  private pickHit(e: PointerEvent): Hit | null {
    if (!this.mesh || !this.data) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    this.raycaster.setFromCamera(new THREE.Vector2((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1), this.camera);
    const faceHit = this.raycaster.intersectObject(this.mesh)[0];
    // An edge or vertex counts as visible if it is not meaningfully behind the face under the
    // pointer; allow slack for the pick radius (it grows at grazing angles).
    const pixelSize = this.pixelSizeAtDistance(faceHit?.distance ?? 0, rect.height);
    const depthLimit = faceHit && !settings.seeThrough ? faceHit.distance * 1.01 + pixelSize * 12 : Infinity;

    const vertex = this.nearestVertex(px, py, rect, depthLimit);
    if (vertex) return vertex;
    const centre = this.nearestCentre(px, py, rect);
    if (centre) return centre;
    const edge = this.nearestEdge(px, py, rect, depthLimit);
    if (edge) return edge;

    if (!faceHit || faceHit.faceIndex == null) return null;
    // Face ranges are sorted by start; find the last range starting at or before this triangle.
    let lo = 0;
    let hi = this.faceStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.faceStarts[mid] <= faceHit.faceIndex) lo = mid;
      else hi = mid - 1;
    }
    const face = this.data.faces[lo];
    return face && face.count > 0 ? { kind: "face", id: face.id, point: faceHit.point } : null;
  }

  private rayAt(e: PointerEvent): THREE.Ray {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    return this.raycaster.ray.clone();
  }

  /** Pressing on a hole centre dot (not just near the hole) begins moving that hole; returns whether it did. */
  private startCentreDrag(e: PointerEvent): boolean {
    if (!this.centresShown.length || e.ctrlKey || e.metaKey) return false;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    for (const c of this.centresShown) {
      const p = new THREE.Vector3(...c.position);
      const n = p.clone().project(this.camera);
      if (n.z > 1 || Math.hypot(((n.x + 1) / 2) * rect.width - px, ((1 - n.y) / 2) * rect.height - py) > CENTRE_HANDLE_PX || this.occluded(p)) continue;
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...c.axis).normalize(), p);
      const start = this.rayAt(e).intersectPlane(plane, new THREE.Vector3());
      if (!start) return false; // looking edge-on along the hole's plane
      this.centreDrag = { face: c.face, origin: p, plane, start, x: e.clientX, y: e.clientY, moved: false };
      if (!this.isSelected({ kind: "face", id: c.face })) {
        const sel = { kind: "face" as const, id: c.face };
        this.selectItems([sel]);
        this.onSelect([sel]);
      }
      this.renderer.domElement.setPointerCapture(e.pointerId);
      return true;
    }
    return false;
  }

  /**
   * With the Divide face form open, pressing on the model and dragging puts the dividing line through the pointer
   * on the face's plane. The line runs across the direction of the first clear movement (move along the face's
   * first axis and the line is parallel to the second); the offset follows the pointer. Returns whether it began.
   */
  private startDivideDrag(e: PointerEvent): boolean {
    const f = this.divideFrame;
    if (!f || e.ctrlKey || e.metaKey || !this.pickHit(e)) return false;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(f.normal, f.centre);
    const start = this.rayAt(e).intersectPlane(plane, new THREE.Vector3());
    if (!start) return false; // looking edge-on along the face
    this.divideDrag = { plane, x: e.clientX, y: e.clientY, start, across: null, offset: 0 };
    this.renderer.domElement.setPointerCapture(e.pointerId);
    return true;
  }

  private moveDivideDrag(e: PointerEvent) {
    const d = this.divideDrag!;
    const f = this.divideFrame;
    const at = f && this.rayAt(e).intersectPlane(d.plane, new THREE.Vector3());
    if (!f || !at) return;
    if (d.across === null) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
      const moved = at.clone().sub(d.start);
      // across 0 = line along u, positioned along v; so movement mostly along v keeps across 0.
      d.across = Math.abs(moved.dot(f.v)) >= Math.abs(moved.dot(f.u)) ? 0 : 1;
    }
    const step = d.across === 0 ? f.v : f.u;
    d.offset = Math.round(at.clone().sub(f.centre).dot(step) * 1000) / 1000;
    this.onDivideDrag(d.across, d.offset, false);
  }

  private centreOffset(e: PointerEvent, c: NonNullable<Viewport["centreDrag"]>): THREE.Vector3 {
    const at = this.rayAt(e).intersectPlane(c.plane, new THREE.Vector3());
    return at ? at.sub(c.start) : new THREE.Vector3();
  }

  private moveCentreDrag(e: PointerEvent) {
    const c = this.centreDrag!;
    const offset = this.centreOffset(e, c);
    if (!c.moved && Math.hypot(e.clientX - c.x, e.clientY - c.y) < 4) return;
    c.moved = true;
    this.onCentreDrag(c.face, offset, "move");
  }

  /** A hole or boss centre near the pointer picks that hole's face (centres sit inside the hole, so no depth test). */
  private nearestCentre(px: number, py: number, rect: DOMRect): Hit | null {
    let best: Hit | null = null;
    let bestDistance = settings.vertexPickPx;
    for (const c of this.centresShown) {
      const p = new THREE.Vector3(...c.position);
      const n = p.clone().project(this.camera);
      if (n.z > 1) continue;
      const d = Math.hypot(((n.x + 1) / 2) * rect.width - px, ((1 - n.y) / 2) * rect.height - py);
      if (d < bestDistance && !this.occluded(p)) {
        bestDistance = d;
        best = { kind: "face", id: c.face, point: p };
      }
    }
    return best;
  }

  private nearestVertex(px: number, py: number, rect: DOMRect, depthLimit: number): Hit | null {
    let best: Hit | null = null;
    let bestDistance = settings.vertexPickPx;
    const p = new THREE.Vector3();
    for (const v of this.data!.vertices) {
      p.set(v.position[0], v.position[1], v.position[2]);
      const depth = p.distanceTo(this.camera.position);
      const n = p.clone().project(this.camera);
      if (n.z > 1 || depth > depthLimit) continue;
      const d = Math.hypot(((n.x + 1) / 2) * rect.width - px, ((1 - n.y) / 2) * rect.height - py);
      if (d < bestDistance) {
        bestDistance = d;
        best = { kind: "vertex", id: v.id, point: p.clone() };
      }
    }
    return best;
  }

  private nearestEdge(px: number, py: number, rect: DOMRect, depthLimit: number): Hit | null {
    const data = this.data!;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    this.camera.updateMatrixWorld();
    let best: Hit | null = null;
    const edgePx = settings.edgePickPx;
    let bestDistance = edgePx;
    let bestDepth = Infinity;
    const toPx = (v: THREE.Vector3) => {
      const n = v.clone().project(this.camera);
      return [((n.x + 1) / 2) * rect.width, ((1 - n.y) / 2) * rect.height, n.z] as const;
    };
    for (const edge of data.edges) {
      for (let i = edge.start; i + 1 < edge.start + edge.count; i += 2) {
        a.fromArray(data.edgePositions, i * 3);
        b.fromArray(data.edgePositions, (i + 1) * 3);
        const [ax, ay, az] = toPx(a);
        const [bx, by, bz] = toPx(b);
        if (az > 1 || bz > 1) continue;
        const dx = bx - ax;
        const dy = by - ay;
        const lengthSq = dx * dx + dy * dy;
        const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
        const d = Math.hypot(ax + t * dx - px, ay + t * dy - py);
        if (d >= edgePx) continue;
        const point = a.clone().lerp(b, t);
        const depth = point.distanceTo(this.camera.position);
        if (depth > depthLimit) continue;
        // Nearest on screen wins, but among candidates within a couple of pixels the one
        // closest to the camera wins (e.g. a hole's front rim over its back rim seen through it).
        if (best && !(d + EDGE_TIE_PX < bestDistance || (d <= bestDistance + EDGE_TIE_PX && depth < bestDepth))) continue;
        bestDistance = d;
        bestDepth = depth;
        best = { kind: "edge", id: edge.id, point };
      }
    }
    return best;
  }

  /** The centre of a circular edge, found from the hole centres: every point of the edge is one radius from it. */
  private circleCentre(edgeId: number): CentreInfo | null {
    const data = this.data;
    const edge = data?.edges.find((e) => e.id === edgeId);
    if (!data || !edge || edge.count < 4) return null;
    const pts: THREE.Vector3[] = [];
    for (let i = edge.start; i < edge.start + edge.count; i++) pts.push(new THREE.Vector3().fromArray(data.edgePositions, i * 3));
    const tol = 1e-3;
    for (const c of data.centres) {
      const centre = new THREE.Vector3(...c.position);
      const axis = new THREE.Vector3(...c.axis).normalize();
      let axial: number | null = null;
      let radius: number | null = null;
      let ok = true;
      for (const p of pts) {
        const d = p.clone().sub(centre);
        const along = d.dot(axis);
        const r = d.addScaledVector(axis, -along).length();
        axial ??= along;
        radius ??= r;
        if (Math.abs(along - axial) > tol || Math.abs(r - radius) > tol || r < tol) {
          ok = false;
          break;
        }
      }
      if (ok && axial !== null) return { face: c.face, position: centre.addScaledVector(axis, axial).toArray() as [number, number, number], axis: c.axis };
    }
    return null;
  }

  /** Show centre dots only for the hovered or selected holes and circular edges. */
  private refreshCentres() {
    const shown: CentreInfo[] = [];
    for (const sel of [this.hovered, ...this.selected]) {
      if (!sel || !this.data) continue;
      if (sel.kind === "face") shown.push(...this.data.centres.filter((c) => c.face === sel.id));
      else if (sel.kind === "edge") {
        const c = this.circleCentre(sel.id);
        if (c) shown.push(c);
      }
    }
    this.centresShown = shown;
    if (this.centreDots) {
      this.centreDots.geometry.dispose();
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(shown.flatMap((c) => c.position)), 3));
      this.centreDots.geometry = g;
    }
  }

  /** World points of the hole and circle centres currently shown, for use as snap targets. */
  get shownCentres(): THREE.Vector3[] {
    return this.centresShown.map((c) => new THREE.Vector3(...c.position));
  }

  private setHover(sel: Sel | null) {
    if (sel?.kind === this.hovered?.kind && sel?.id === this.hovered?.id) return;
    this.hovered = sel;
    this.refreshCentres();
    this.show(this.hoverMark, sel);
    this.renderer.domElement.style.cursor = sel ? "pointer" : "";
  }

  private isSelected(sel: Sel): boolean {
    return this.selected.some((s) => s.kind === sel.kind && s.id === sel.id);
  }

  /** Faintly highlight faces related to the selection (the relationship rules that are switched on). */
  setRelated(sels: Sel[]) {
    while (this.relatedMarks.length < sels.length && this.markSource) {
      this.relatedMarks.push(new Mark(this.model, this.markSource, 0xffb36b, 0.4, this.hoverLine));
    }
    this.relatedMarks.forEach((mark, i) => this.show(mark, sels[i] ?? null));
  }

  /** Select programmatically (no onSelect callback). */
  selectItems(sels: Sel[]) {
    this.selected = sels;
    this.refreshCentres();
    while (this.selectedMarks.length < sels.length && this.markSource) {
      this.selectedMarks.push(new Mark(this.model, this.markSource, 0xff8a1f, 0.85, this.selectedLine));
    }
    this.selectedMarks.forEach((mark, i) => this.show(mark, sels[i] ?? null));
  }

  /** Plain click replaces the selection; Ctrl+click toggles an item (all items must be of one kind). */
  private clickSelect(sel: Sel | null, additive: boolean) {
    let next: Sel[];
    if (!additive) next = sel ? [sel] : [];
    else if (!sel) next = this.selected;
    else if (this.isSelected(sel)) next = this.selected.filter((s) => !(s.kind === sel.kind && s.id === sel.id));
    else next = this.selected.length && this.selected[0].kind === sel.kind ? [...this.selected, sel] : [sel];
    this.selectItems(next);
    this.onSelect(next);
  }

  private frame([x0, y0, z0, x1, y1, z1]: number[]) {
    const center = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const radius = Math.max(Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2, 1e-3);
    const distance = radius / Math.sin((PERSPECTIVE_FOV * Math.PI) / 360);
    this.orthoHalf = distance * Math.tan((PERSPECTIVE_FOV * Math.PI) / 360);
    this.orthoCamera.zoom = 1;
    this.syncOrtho();
    this.camera.position.copy(center).add(new THREE.Vector3(1, -1.4, 0.9).normalize().multiplyScalar(distance));
    this.camera.near = distance / 100;
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
  }
}
