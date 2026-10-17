import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { FaceRange, MeshData } from "./client";

export class Viewport {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
  readonly renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  private controls: OrbitControls;
  private model = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private faces: FaceRange[] = [];
  private faceStarts: number[] = [];
  private hoverFace: number | null = null;
  private hoverMesh: THREE.Mesh | null = null;
  private selectedMesh: THREE.Mesh | null = null;
  private raycaster = new THREE.Raycaster();
  private selectedId: number | null = null;
  private drag: { face: number; normal: THREE.Vector3; point: THREE.Vector3; x: number; y: number; moved: boolean } | null = null;
  onSelect: (face: number | null) => void = () => {};
  /** distance is along the face's outward normal, in model units. */
  onFaceDrag: (face: number, distance: number, phase: "move" | "end" | "cancel") => void = () => {};

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
    const dom = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    dom.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY };
      if (e.button !== 0) return;
      const hit = this.pickHit(e);
      const range = hit && this.faces.find((f) => f.id === hit.face);
      // Dragging the selected planar face starts push/pull instead of orbiting.
      if (hit && hit.face === this.selectedId && range?.normal) {
        this.drag = { face: hit.face, normal: new THREE.Vector3(...range.normal), point: hit.point, x: e.clientX, y: e.clientY, moved: false };
        this.controls.enabled = false;
        dom.setPointerCapture(e.pointerId);
      }
    });
    dom.addEventListener("pointermove", (e) => {
      if (this.drag) {
        const distance = this.dragDistance(e);
        if (this.drag.moved || Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) >= 4) {
          this.drag.moved = true;
          this.onFaceDrag(this.drag.face, distance, "move");
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
          this.onFaceDrag(drag.face, this.dragDistance(e, drag), "end");
          down = null;
          return;
        }
      }
      // A click, not the end of an orbit/pan drag.
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4 && e.button === 0) {
        this.setSelected(this.pick(e));
      }
      down = null;
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.drag) {
        const face = this.drag.face;
        this.drag = null;
        this.controls.enabled = true;
        this.onFaceDrag(face, 0, "cancel");
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
  }

  setMesh(mesh: MeshData, frame: boolean) {
    for (const child of [...this.model.children]) {
      this.model.remove(child);
      (child as THREE.Mesh).geometry?.dispose();
    }
    this.hoverMesh = this.selectedMesh = null;
    this.hoverFace = null;
    this.selectedId = null;
    this.faces = mesh.faces;
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
    this.hoverMesh = this.highlightMesh(geometry, 0xffd36b, 0.55);
    this.selectedMesh = this.highlightMesh(geometry, 0xff8a1f, 0.85);

    const edges = new THREE.BufferGeometry();
    edges.setAttribute("position", new THREE.BufferAttribute(mesh.edgePositions, 3));
    this.model.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x111418 })));

    if (frame) this.frame(mesh.bounds);
  }

  private highlightMesh(source: THREE.BufferGeometry, color: number, opacity: number) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", source.getAttribute("position"));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1));
    const material = new THREE.MeshBasicMaterial({
      color,
      opacity,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.renderOrder = 1;
    this.model.add(mesh);
    return mesh;
  }

  private showFace(target: THREE.Mesh | null, face: number | null) {
    if (!target || !this.mesh) return;
    const range = this.faces.find((f) => f.id === face);
    target.visible = range !== undefined;
    if (range) {
      const source = this.mesh.geometry.getIndex()!.array as Uint32Array;
      target.geometry.setIndex(new THREE.BufferAttribute(source.subarray(range.start, range.start + range.count), 1));
    }
  }

  private pick(e: PointerEvent): number | null {
    return this.pickHit(e)?.face ?? null;
  }

  /** Distance along the dragged face's normal implied by the pointer position. */
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

  /** Face id and hit point under the pointer, or null. */
  private pickHit(e: PointerEvent): { face: number; point: THREE.Vector3 } | null {
    if (!this.mesh) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.mesh)[0];
    if (!hit || hit.faceIndex == null) return null;
    // Face ranges are sorted by start; find the last range starting at or before this triangle.
    let lo = 0;
    let hi = this.faceStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.faceStarts[mid] <= hit.faceIndex) lo = mid;
      else hi = mid - 1;
    }
    const face = this.faces[lo];
    return face && face.count > 0 ? { face: face.id, point: hit.point } : null;
  }

  private setHover(face: number | null) {
    if (face === this.hoverFace) return;
    this.hoverFace = face;
    this.showFace(this.hoverMesh, face);
    this.renderer.domElement.style.cursor = face === null ? "" : "pointer";
  }

  /** Select programmatically (no onSelect callback). */
  selectFace(face: number | null) {
    this.selectedId = face;
    this.showFace(this.selectedMesh, face);
  }

  private setSelected(face: number | null) {
    this.selectedId = face;
    this.showFace(this.selectedMesh, face);
    this.onSelect(face);
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
