/** The push/pull direction gizmo: a pick icon just past the arrow's head and four arcs of 120 degrees (60 either side of their middle) around it.
 *  Pressing the icon asks for a vector to pick (an edge, see main.ts); dragging an arc leans the arrow toward the side the arc is on.
 *  It follows the push/pull arrow handle of the manipulator and holds no state of its own beyond the drag in progress. */
import * as THREE from "three";
import { ARM_PX, GRAB_PX, type Manipulator } from "./manipulator.ts";
import { angleFromNormal, sideFrame, tiltFromDrag, type PullDirection, type Vec } from "./pulldir.ts";

const COLOR = 0xc8ccd4;
const COLOR_HOT = 0xffb347;
const OUTLINE = 0x1b1d22;
/** Where the icon sits past the arrow's head, and the arcs' radius, both in arrow lengths. */
const ICON_AT = 1.38;
const ARC_RADIUS = 0.34;
const ARC_HALF_SPAN = Math.PI / 3;
const ARC_STEPS = 16;
const ARC_GRAB_PX = 7;

type Hot = { kind: "pick" } | { kind: "arc"; side: number };

interface Layout {
  base: THREE.Vector3;
  direction: Vec;
  length: number;
  sides: Vec[];
}

interface ArcDrag {
  side: Vec;
  direction: Vec;
  x: number;
  y: number;
  sidePx: THREE.Vector2;
}

export class PullGizmo {
  /** Called when the pick icon is pressed. */
  onPick: () => void = () => {};

  private readonly group = new THREE.Group();
  private readonly icon: THREE.Mesh;
  private readonly arcs: THREE.Line[] = [];
  private readonly label: HTMLElement;
  private hot: Hot | null = null;
  private drag: ArcDrag | null = null;
  private live: Vec | null = null;
  private layout: Layout | null = null;

  constructor(
    scene: THREE.Scene,
    private readonly camera: () => THREE.Camera,
    private readonly dom: HTMLElement,
    private readonly pixelSizeAt: (p: THREE.Vector3) => number,
    private readonly manipulator: Manipulator,
    private readonly state: PullDirection,
  ) {
    this.group.renderOrder = 10;
    const geometry = new THREE.SphereGeometry(0.075, 14, 10);
    this.icon = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: COLOR, depthTest: false, transparent: true }));
    const outline = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide, depthTest: false, transparent: true, opacity: 0.6 }));
    outline.scale.setScalar(1.25);
    this.icon.add(outline);
    this.icon.renderOrder = 11;
    this.group.add(this.icon);
    for (let i = 0; i < 4; i++) {
      const arc = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: COLOR, depthTest: false, transparent: true }));
      arc.renderOrder = 10;
      this.arcs.push(arc);
      this.group.add(arc);
    }
    this.group.visible = false;
    scene.add(this.group);
    this.label = document.createElement("div");
    this.label.style.cssText = "position:absolute;padding:1px 5px;border-radius:3px;background:rgba(20,20,24,.85);color:#ffd9a0;font:11px sans-serif;white-space:nowrap;transform:translate(14px,-50%);pointer-events:none";
    this.label.hidden = true;
    dom.parentElement!.append(this.label);
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  private screen(p: THREE.Vector3): THREE.Vector2 {
    const rect = this.dom.getBoundingClientRect();
    const n = p.clone().project(this.camera());
    return new THREE.Vector2(((n.x + 1) / 2) * rect.width + rect.left, ((1 - n.y) / 2) * rect.height + rect.top);
  }

  private centre(layout: Layout): THREE.Vector3 {
    return layout.base.clone().addScaledVector(new THREE.Vector3(...layout.direction), layout.length * ICON_AT);
  }

  /** The points of one arc of a layout, in the world. */
  private arcPoints(layout: Layout, side: number): THREE.Vector3[] {
    const d = new THREE.Vector3(...layout.direction);
    const s = new THREE.Vector3(...layout.sides[side]);
    const centre = this.centre(layout);
    return Array.from({ length: ARC_STEPS + 1 }, (_, i) => {
      const a = -ARC_HALF_SPAN + (2 * ARC_HALF_SPAN * i) / ARC_STEPS;
      return centre.clone().addScaledVector(s, Math.cos(a) * ARC_RADIUS * layout.length).addScaledVector(d, Math.sin(a) * ARC_RADIUS * layout.length);
    });
  }

  /** Per frame: follow the push/pull arrow, keep a constant size on screen, show the lean while there is one. */
  update() {
    const handle = this.manipulator.pushPullHandle();
    if (!handle || this.manipulator.dragging) {
      this.group.visible = false;
      this.label.hidden = true;
      this.layout = null;
      return;
    }
    if (!this.state.dir) this.state.normal = handle.direction;
    const direction = this.live ?? handle.direction;
    const base = new THREE.Vector3(...handle.anchor);
    const length = this.pixelSizeAt(base) * ARM_PX;
    const [a, b] = sideFrame(direction);
    const layout: Layout = { base, direction, length, sides: [a, b, [-a[0], -a[1], -a[2]], [-b[0], -b[1], -b[2]]] };
    this.layout = layout;
    this.group.visible = true;
    const centre = this.centre(layout);
    this.icon.position.copy(centre);
    this.icon.scale.setScalar(length * (this.hot?.kind === "pick" ? 1.25 : 1));
    (this.icon.material as THREE.MeshBasicMaterial).color.setHex(this.hot?.kind === "pick" ? COLOR_HOT : COLOR);
    this.arcs.forEach((arc, i) => {
      arc.geometry.setFromPoints(this.arcPoints(layout, i));
      (arc.material as THREE.LineBasicMaterial).color.setHex(this.hot?.kind === "arc" && this.hot.side === i ? COLOR_HOT : COLOR);
    });
    const lean = this.state.dir && this.state.normal ? angleFromNormal(this.state.dir, this.state.normal) : 0;
    this.label.hidden = lean < 0.05;
    if (!this.label.hidden) {
      const rect = this.dom.getBoundingClientRect();
      const p = this.screen(centre);
      this.label.textContent = `${Math.round(lean * 10) / 10}° off the face normal`;
      this.label.style.left = `${p.x - rect.left}px`;
      this.label.style.top = `${p.y - rect.top}px`;
    }
  }

  /** What is under the pointer, if the gizmo is shown. */
  private hit(e: { clientX: number; clientY: number }): Hot | null {
    const layout = this.layout;
    if (!layout || !this.group.visible) return null;
    const pointer = new THREE.Vector3(e.clientX, e.clientY, 0);
    if (this.screen(this.icon.position).distanceTo(new THREE.Vector2(pointer.x, pointer.y)) <= GRAB_PX) return { kind: "pick" };
    let best: Hot | null = null;
    let bestD = ARC_GRAB_PX;
    for (let side = 0; side < 4; side++) {
      const points = this.arcPoints(layout, side).map((p) => this.screen(p));
      for (let i = 0; i + 1 < points.length; i++) {
        const segment = new THREE.Line3(new THREE.Vector3(points[i].x, points[i].y, 0), new THREE.Vector3(points[i + 1].x, points[i + 1].y, 0));
        const d = segment.closestPointToPoint(pointer, true, new THREE.Vector3()).distanceTo(pointer);
        if (d < bestD) {
          bestD = d;
          best = { kind: "arc", side };
        }
      }
    }
    return best;
  }

  /** Hover feedback; returns whether the pointer is over the gizmo. */
  hover(e: { clientX: number; clientY: number }): boolean {
    const now = this.hit(e);
    if (JSON.stringify(now) !== JSON.stringify(this.hot)) {
      this.hot = now;
      this.dom.style.cursor = now ? "grab" : "";
    }
    return now !== null;
  }

  down(e: PointerEvent): boolean {
    const hot = this.hit(e);
    const layout = this.layout;
    if (!hot || !layout) return false;
    if (hot.kind === "pick") {
      this.onPick();
      return true;
    }
    const side = layout.sides[hot.side];
    const middle = this.arcPoints(layout, hot.side)[ARC_STEPS / 2];
    const sidePx = this.screen(middle.clone().addScaledVector(new THREE.Vector3(...side), layout.length)).sub(this.screen(middle));
    this.drag = { side, direction: layout.direction, x: e.clientX, y: e.clientY, sidePx: sidePx.lengthSq() < 4 ? new THREE.Vector2(1, 0) : sidePx.normalize() };
    this.live = layout.direction;
    this.dom.style.cursor = "grabbing";
    return true;
  }

  move(e: PointerEvent) {
    const drag = this.drag;
    if (!drag || !this.state.normal) return;
    const pixels = new THREE.Vector2(e.clientX - drag.x, e.clientY - drag.y).dot(drag.sidePx);
    this.live = tiltFromDrag(drag.direction, drag.side, this.state.normal, pixels, ARM_PX);
    this.state.set(this.live);
  }

  up() {
    this.drag = null;
    this.live = null;
    this.dom.style.cursor = "";
  }
}
