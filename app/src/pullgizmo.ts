/** The push/pull direction gizmo: four arcs of 120 degrees, drawn as if on a hemisphere around the arrow (each runs 60 degrees either side of the arrowhead's tip,
 *  in the colour of the axis it turns about, like the rotate gizmo's rings), and the UI's pick icon just past the tip.
 *  Pressing the icon asks for a vector to pick (an edge, see main.ts); dragging an arc leans the arrow along it.
 *  It follows the push/pull arrow handle of the manipulator and holds no state of its own beyond the drag in progress. */
import * as THREE from "three";
import { uiIcon } from "./icons";
import { ARM_PX, axisColorOf, type Manipulator } from "./manipulator.ts";
import { angleFromNormal, arcSide, sideFrame, tiltFromDrag, type PullDirection, type Vec } from "./pulldir.ts";

const COLOR_HOT = 0xffffff; // the hover colour of the move and rotate gizmos
/** The arcs lie on a sphere around the arrow's base whose radius is the arrow length, so they pass through the arrowhead's tip; the pick icon sits past it, in arrow lengths. */
const ICON_AT = 1.32;
const ARC_HALF_SPAN = Math.PI / 3;
const ARC_STEPS = 24;
const ARC_GRAB_PX = 8;
/** The four arcs are great-circle arcs through the tip, turned 45 degrees apart: left-right, up-down and the two diagonals. */
const ARC_AZIMUTHS = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4];
const REST_OPACITY = 0.9; // stronger than the rotation rings (0.55): the arcs are short and cross a coloured face

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
  private readonly arcs: THREE.Line[] = [];
  private readonly pick: HTMLButtonElement;
  private readonly label: HTMLElement;
  private hot: number | null = null;
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
    for (let i = 0; i < 4; i++) {
      const arc = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ depthTest: false, transparent: true, opacity: REST_OPACITY }));
      arc.renderOrder = 9;
      this.arcs.push(arc);
      this.group.add(arc);
    }
    this.group.visible = false;
    scene.add(this.group);
    const layer = dom.parentElement!;
    this.pick = document.createElement("button");
    this.pick.type = "button";
    this.pick.className = "iconbtn";
    this.pick.title = "Pick the push/pull direction: click a straight edge (or a face for its normal); the selected face goes back to its own normal";
    this.pick.style.cssText = "position:absolute;display:none;padding:3px;line-height:0;transform:translate(-50%,-50%);z-index:5;background:rgba(32,34,40,.9);border:1px solid #666;border-radius:4px;color:#ddd;cursor:pointer";
    this.pick.append(uiIcon("pickBase", 18));
    this.pick.addEventListener("click", () => this.onPick());
    layer.append(this.pick);
    this.label = document.createElement("div");
    this.label.style.cssText = "position:absolute;padding:1px 5px;border-radius:3px;background:rgba(20,20,24,.85);color:#ffd9a0;font:11px sans-serif;white-space:nowrap;transform:translate(16px,-50%);pointer-events:none";
    this.label.hidden = true;
    layer.append(this.label);
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  private screen(p: THREE.Vector3): THREE.Vector2 {
    const rect = this.dom.getBoundingClientRect();
    const n = p.clone().project(this.camera());
    return new THREE.Vector2(((n.x + 1) / 2) * rect.width + rect.left, ((1 - n.y) / 2) * rect.height + rect.top);
  }

  /** The points of one arc of a layout, in the world: a great circle of the sphere around the base, 60 degrees either side of the tip. */
  private arcPoints(layout: Layout, side: number): THREE.Vector3[] {
    const d = new THREE.Vector3(...layout.direction);
    const s = new THREE.Vector3(...layout.sides[side]);
    return Array.from({ length: ARC_STEPS + 1 }, (_, i) => {
      const a = -ARC_HALF_SPAN + (2 * ARC_HALF_SPAN * i) / ARC_STEPS;
      return layout.base.clone().addScaledVector(d, Math.cos(a) * layout.length).addScaledVector(s, Math.sin(a) * layout.length);
    });
  }

  private hide() {
    this.group.visible = false;
    this.label.hidden = true;
    this.pick.style.display = "none";
    this.layout = null;
  }

  /** Per frame: follow the push/pull arrow, keep a constant size on screen, show the lean while there is one. */
  update() {
    const handle = this.manipulator.pushPullHandle();
    if (!handle || this.manipulator.dragging) return this.hide();
    if (!this.state.dir) this.state.normal = handle.direction;
    const direction = this.live ?? handle.direction;
    const base = new THREE.Vector3(...handle.anchor);
    const length = this.pixelSizeAt(base) * ARM_PX;
    const [e1, e2] = sideFrame(direction);
    const layout: Layout = { base, direction, length, sides: ARC_AZIMUTHS.map((a) => arcSide(e1, e2, a)) };
    this.layout = layout;
    this.group.visible = true;
    this.arcs.forEach((arc, i) => {
      arc.geometry.setFromPoints(this.arcPoints(layout, i));
      const material = arc.material as THREE.LineBasicMaterial;
      const axis = new THREE.Vector3(...direction).cross(new THREE.Vector3(...layout.sides[i])); // the axis this arc's tilt turns about
      const hot = this.hot === i || this.drag !== null;
      material.color.setHex(hot && this.hot === i ? COLOR_HOT : axisColorOf([axis.x, axis.y, axis.z]));
      material.opacity = hot && this.hot === i ? 1 : REST_OPACITY;
    });
    const tip = base.clone().addScaledVector(new THREE.Vector3(...direction), length * ICON_AT);
    const rect = this.dom.getBoundingClientRect();
    const icon = this.screen(tip);
    this.pick.style.display = "block";
    this.pick.style.left = `${icon.x - rect.left}px`;
    this.pick.style.top = `${icon.y - rect.top}px`;
    const lean = this.state.dir && this.state.normal ? angleFromNormal(this.state.dir, this.state.normal) : 0;
    this.label.hidden = lean < 0.05;
    if (!this.label.hidden) {
      this.label.textContent = `${Math.round(lean * 10) / 10}° off the face normal`;
      this.label.style.left = `${icon.x - rect.left + 12}px`;
      this.label.style.top = `${icon.y - rect.top}px`;
    }
  }

  /** The arc under the pointer, if the gizmo is shown. */
  private hit(e: { clientX: number; clientY: number }): number | null {
    const layout = this.layout;
    if (!layout || !this.group.visible) return null;
    const pointer = new THREE.Vector3(e.clientX, e.clientY, 0);
    let best: number | null = null;
    let bestD = ARC_GRAB_PX;
    for (let side = 0; side < 4; side++) {
      const points = this.arcPoints(layout, side).map((p) => this.screen(p));
      for (let i = 0; i + 1 < points.length; i++) {
        const segment = new THREE.Line3(new THREE.Vector3(points[i].x, points[i].y, 0), new THREE.Vector3(points[i + 1].x, points[i + 1].y, 0));
        const d = segment.closestPointToPoint(pointer, true, new THREE.Vector3()).distanceTo(pointer);
        if (d < bestD) {
          bestD = d;
          best = side;
        }
      }
    }
    return best;
  }

  /** Hover feedback; returns whether the pointer is over an arc. */
  hover(e: { clientX: number; clientY: number }): boolean {
    const now = this.hit(e);
    if (now !== this.hot) {
      this.hot = now;
      this.dom.style.cursor = now !== null ? "grab" : "";
    }
    return now !== null;
  }

  down(e: PointerEvent): boolean {
    const hot = this.hit(e);
    const layout = this.layout;
    if (hot === null || !layout) return false;
    const side = layout.sides[hot];
    const tip = layout.base.clone().addScaledVector(new THREE.Vector3(...layout.direction), layout.length);
    const sidePx = this.screen(tip.clone().addScaledVector(new THREE.Vector3(...side), layout.length)).sub(this.screen(tip));
    this.drag = { side, direction: layout.direction, x: e.clientX, y: e.clientY, sidePx: sidePx.lengthSq() < 4 ? new THREE.Vector2(1, 0) : sidePx.normalize() };
    this.live = layout.direction;
    this.hot = hot;
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
    this.hot = null;
    this.dom.style.cursor = "";
  }
}
