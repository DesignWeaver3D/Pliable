import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { MeshData } from "./client";

export type Kind = "face" | "edge" | "vertex";
export interface Sel {
  kind: Kind;
  id: number;
}

interface Hit extends Sel {
  point: THREE.Vector3;
}

const VERTEX_PICK_PX = 9;
const EDGE_PICK_PX = 6;
const EDGE_TIE_PX = 2; // edges this close on screen are told apart by depth

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

export class Viewport {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
  readonly renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  private controls: OrbitControls;
  private model = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private data: MeshData | null = null;
  private faceStarts: number[] = [];
  private hovered: Sel | null = null;
  private selected: Sel[] = [];
  private markSource: THREE.BufferGeometry | null = null;
  private selectedMarks: Mark[] = [];
  private hoverMark: Mark | null = null;
  private hoverLine = new LineMaterial({ color: 0xffd36b, linewidth: 3, depthTest: true });
  private selectedLine = new LineMaterial({ color: 0xff8a1f, linewidth: 4, depthTest: true });
  private raycaster = new THREE.Raycaster();
  private drag: { sels: Sel[]; normal: THREE.Vector3; point: THREE.Vector3; x: number; y: number; moved: boolean } | null = null;
  /** Called when the user changes the selection by clicking. */
  onSelect: (selection: Sel[]) => void = () => {};
  /** Dragging a selected face or edge drives its tool on the whole selection. distance is in model units along the dragged item's outward direction. */
  onItemDrag: (sels: Sel[], distance: number, phase: "move" | "end" | "cancel") => void = () => {};

  constructor(container: HTMLElement) {
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x1b1d22);
    this.scene.add(this.model);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1, 2, 3);
    this.camera.add(key);
    this.scene.add(this.camera);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    // Navigation: left selects (and drags tools), right orbits,
    // middle pans, the wheel zooms toward the cursor.
    this.controls.mouseButtons = { LEFT: null as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.zoomToCursor = true;
    const dom = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    dom.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY };
      if (e.button !== 0) return;
      const hit = this.pickHit(e);
      const direction = hit && this.dragDirection(hit);
      // Dragging the selected face or edge starts its tool instead of orbiting.
      const additive = e.ctrlKey || e.metaKey;
      if (hit && direction && !additive) {
        // Pressing on an item selects it and starts its tool drag in one motion.
        if (!this.isSelected(hit)) {
          const sel = { kind: hit.kind, id: hit.id };
          this.selectItems([sel]);
          this.onSelect([sel]);
        }
        this.drag = { sels: [...this.selected], normal: direction, point: hit.point, x: e.clientX, y: e.clientY, moved: false };
        this.controls.enabled = false;
        dom.setPointerCapture(e.pointerId);
      }
    });
    dom.addEventListener("pointermove", (e) => {
      if (this.drag) {
        const distance = this.dragDistance(e);
        if (this.drag.moved || Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) >= 4) {
          this.drag.moved = true;
          this.onItemDrag(this.drag.sels, distance, "move");
        }
      } else if (e.buttons === 0) this.setHover(this.pick(e));
    });
    dom.addEventListener("pointerleave", () => this.setHover(null));
    dom.addEventListener("pointerup", (e) => {
      const drag = this.drag;
      if (drag) {
        this.drag = null;
        this.controls.enabled = true;
        if (drag.moved) {
          this.onItemDrag(drag.sels, this.dragDistance(e, drag), "end");
          down = null;
          return;
        }
      }
      // A click, not the end of an orbit/pan drag.
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4 && e.button === 0) {
        this.clickSelect(this.pick(e), e.ctrlKey || e.metaKey);
      }
      down = null;
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.drag) {
        const sels = this.drag.sels;
        this.drag = null;
        this.controls.enabled = true;
        this.onItemDrag(sels, 0, "cancel");
      }
    });
    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.renderer.domElement.parentElement!;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.hoverLine.resolution.set(w, h);
    this.selectedLine.resolution.set(w, h);
  }

  setMesh(mesh: MeshData, frame: boolean) {
    for (const child of [...this.model.children]) {
      this.model.remove(child);
      (child as THREE.Mesh).geometry?.dispose();
    }
    this.hovered = null;
    this.selected = [];
    this.selectedMarks = [];
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
    this.hoverMark = new Mark(this.model, geometry, 0xffd36b, 0.55, this.hoverLine);
    this.markSource = geometry;

    const edges = new THREE.BufferGeometry();
    edges.setAttribute("position", new THREE.BufferAttribute(mesh.edgePositions, 3));
    this.model.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x111418 })));

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
    const pixelSize = (2 * (faceHit?.distance ?? 0) * Math.tan((this.camera.fov * Math.PI) / 360)) / rect.height;
    const depthLimit = faceHit ? faceHit.distance * 1.01 + pixelSize * 12 : Infinity;

    const vertex = this.nearestVertex(px, py, rect, depthLimit);
    if (vertex) return vertex;
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

  private nearestVertex(px: number, py: number, rect: DOMRect, depthLimit: number): Hit | null {
    let best: Hit | null = null;
    let bestDistance = VERTEX_PICK_PX;
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
    let bestDistance = EDGE_PICK_PX;
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
        if (d >= EDGE_PICK_PX) continue;
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

  private setHover(sel: Sel | null) {
    if (sel?.kind === this.hovered?.kind && sel?.id === this.hovered?.id) return;
    this.hovered = sel;
    this.show(this.hoverMark, sel);
    this.renderer.domElement.style.cursor = sel ? "pointer" : "";
  }

  private isSelected(sel: Sel): boolean {
    return this.selected.some((s) => s.kind === sel.kind && s.id === sel.id);
  }

  /** Select programmatically (no onSelect callback). */
  selectItems(sels: Sel[]) {
    this.selected = sels;
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
    const distance = radius / Math.sin((this.camera.fov * Math.PI) / 360);
    this.camera.position.copy(center).add(new THREE.Vector3(1, -1.4, 0.9).normalize().multiplyScalar(distance));
    this.camera.near = distance / 100;
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
  }
}
