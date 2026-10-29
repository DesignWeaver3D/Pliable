/** The push/pull direction gizmo: two arcs of 120 degrees, drawn as if on a hemisphere around the arrow (each runs 60 degrees either side of the arrowhead's tip,
 *  so it covers both ways of its axis: four cardinal tilts), and the UI's pick icon just past the tip. The red arc swings the arrow toward the x axis of the sketch
 *  plane on the face (about the face's y axis) and the green arc toward its y axis (about its x axis). Pressing the icon asks for a vector to pick (an edge, see main.ts).
 *  It follows the push/pull arrow handle of the manipulator and holds no state of its own beyond the drag in progress. */
import * as THREE from "three";
import { uiIcon } from "./icons";
import { AXIS_COLORS } from "./axes.ts";
import { ARM_PX, type Manipulator } from "./manipulator.ts";
import { angleFromNormal, sideFrame, sideToward, tiltAlong, tiltFromDrag, typedTiltKeeping, type PullDirection, type Vec } from "./pulldir.ts";
import { TypedFields } from "./typedentry.ts";

const COLOR_HOT = 0xffffff; // the hover colour of the move and rotate gizmos
/** The pick icon (the target) sits where the two arcs cross: on the arc sphere, straight above the arrow's base (see PUSH_PULL_ARM_RATIO: the arrow's stem runs on past it). */
const ICON_AT = 1;
/** The sphere the arcs lie on is a little larger than the arrow, so the arcs stand clear of its head (in arrow lengths). */
const SPHERE = 1.5;
const ARC_HALF_SPAN = Math.PI / 3;
const ARC_STEPS = 24;
const ARC_GRAB_PX = 8;
/** The red arc swings toward the face's x axis, the green one toward its y axis (the colours of those axes). */
const ARC_COLORS = [AXIS_COLORS.x, AXIS_COLORS.y];
const REST_OPACITY = 0.9; // stronger than the rotation rings (0.55): the arcs are short and cross a coloured face

interface Layout {
  base: THREE.Vector3;
  direction: Vec;
  length: number;
  sides: Vec[];
  /** The face's own x and y axes the two arcs swing toward. */
  axes: Vec[];
}

interface ArcDrag {
  side: Vec;
  direction: Vec;
  x: number;
  y: number;
  sidePx: THREE.Vector2;
  /** The direction chosen before this drag (null: the face normal), and the arc's side seen from the face normal (typed degrees are measured from the normal). */
  start: Vec | null;
  baseSide: Vec;
  /** The other arc's side seen from the face normal (its angle is kept when degrees are typed on this arc). */
  otherSide: Vec;
  /** +1 or -1: the way the arc was pulled, so typed positive degrees continue that way (set when typing starts). */
  sign: number;
}

export class PullGizmo {
  /** Called when the pick icon is pressed. */
  onPick: () => void = () => {};
  /** Called at the end of every frame the gizmo is shown (the Push/Pull card follows the tilts). */
  onFrame: () => void = () => {};

  private readonly group = new THREE.Group();
  /** Set while a point is being picked (see Viewport.setGizmosHidden). */
  hidden = false;
  private readonly arcs: THREE.Line[] = [];
  private readonly pick: HTMLButtonElement;
  private readonly label: HTMLElement;
  private hot: number | null = null;
  private drag: ArcDrag | null = null;
  private live: Vec | null = null;
  private layout: Layout | null = null;
  /** Typed entry of the tilt in degrees while an arc is held (null while the mouse sets it). */
  private fields: TypedFields | null = null;
  private released = false;

  constructor(
    scene: THREE.Scene,
    private readonly camera: () => THREE.Camera,
    private readonly dom: HTMLElement,
    private readonly pixelSizeAt: (p: THREE.Vector3) => number,
    private readonly manipulator: Manipulator,
    private readonly state: PullDirection,
  ) {
    this.group.renderOrder = 10;
    for (let i = 0; i < 2; i++) {
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
    // No backing and no padding: only the icon's own strokes cover anything behind it.
    this.pick.style.cssText = "position:absolute;display:none;padding:0;margin:0;line-height:0;transform:translate(-50%,-50%);z-index:5;background:none;border:none;color:#e8e8e8;cursor:pointer;filter:drop-shadow(0 0 1.5px #000)";
    this.pick.append(uiIcon("pickBase", 22));
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
      const radius = layout.length * SPHERE;
      return layout.base.clone().addScaledVector(d, Math.cos(a) * radius).addScaledVector(s, Math.sin(a) * radius);
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
    if (!handle || this.manipulator.dragging || this.hidden) return this.hide();
    if (!this.state.dir) this.state.normal = handle.direction;
    const direction = this.live ?? handle.direction;
    const base = new THREE.Vector3(...handle.anchor);
    const length = this.pixelSizeAt(base) * ARM_PX;
    const [e1, e2] = handle.frame ?? sideFrame(direction);
    const layout: Layout = { base, direction, length, sides: [sideToward(direction, e1), sideToward(direction, e2)], axes: [e1, e2] };
    this.layout = layout;
    this.group.visible = true;
    this.arcs.forEach((arc, i) => {
      arc.geometry.setFromPoints(this.arcPoints(layout, i));
      const material = arc.material as THREE.LineBasicMaterial;
      material.color.setHex(this.hot === i ? COLOR_HOT : ARC_COLORS[i]);
      material.opacity = this.hot === i ? 1 : REST_OPACITY;
    });
    const tip = base.clone().addScaledVector(new THREE.Vector3(...direction), length * SPHERE * ICON_AT);
    const rect = this.dom.getBoundingClientRect();
    const icon = this.screen(tip);
    this.pick.style.display = "block";
    this.pick.style.left = `${icon.x - rect.left}px`;
    this.pick.style.top = `${icon.y - rect.top}px`;
    const lean = this.state.dir && this.state.normal ? angleFromNormal(this.state.dir, this.state.normal) : 0;
    this.label.hidden = lean < 0.05 && !this.fields;
    if (!this.label.hidden) {
      this.label.textContent = this.fields ? `Tilt ${this.fields.shown(0, String(Math.round(lean * 10) / 10))}° off the face normal` : `${Math.round(lean * 10) / 10}° off the face normal`;
      this.label.style.outline = this.fields ? "1px solid #ffb347" : "";
      this.label.style.left = `${icon.x - rect.left + 12}px`;
      this.label.style.top = `${icon.y - rect.top}px`;
    }
    this.onFrame();
  }

  /** The tilt of the chosen direction along the red and green arcs in degrees from the face normal (what the Push/Pull card shows), or null while the gizmo is not shown. */
  tilts(): [number, number] | null {
    const layout = this.layout;
    const normal = this.state.normal;
    if (!layout || !normal) return null;
    const sides = layout.axes.map((axis) => sideToward(normal, axis));
    return [tiltAlong(normal, sides[0], this.state.dir), tiltAlong(normal, sides[1], this.state.dir)];
  }

  /** Set the tilt along one or both arcs from typed degrees (null keeps that arc's angle), like typing on a held arc. */
  setTilts(red: number | null, green: number | null) {
    const layout = this.layout;
    const normal = this.state.normal;
    if (!layout || !normal) return;
    const [a, b] = layout.axes.map((axis) => sideToward(normal, axis));
    let dir = this.state.dir;
    if (red !== null) dir = typedTiltKeeping(normal, a, b, dir, red);
    if (green !== null) dir = typedTiltKeeping(normal, b, a, dir, green);
    this.state.set(dir);
  }

  /** The arc under the pointer, if the gizmo is shown. */
  private hit(e: { clientX: number; clientY: number }): number | null {
    const layout = this.layout;
    if (!layout || !this.group.visible) return null;
    const pointer = new THREE.Vector3(e.clientX, e.clientY, 0);
    let best: number | null = null;
    let bestD = ARC_GRAB_PX;
    for (let side = 0; side < 2; side++) {
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
    const tip = layout.base.clone().addScaledVector(new THREE.Vector3(...layout.direction), layout.length * SPHERE);
    const sidePx = this.screen(tip.clone().addScaledVector(new THREE.Vector3(...side), layout.length)).sub(this.screen(tip));
    const normal = this.state.normal ?? layout.direction;
    this.drag = { side, direction: layout.direction, x: e.clientX, y: e.clientY, start: this.state.dir, baseSide: sideToward(normal, layout.axes[hot]), otherSide: sideToward(normal, layout.axes[1 - hot]), sign: 1, sidePx: sidePx.lengthSq() < 4 ? new THREE.Vector2(1, 0) : sidePx.normalize() };
    this.live = layout.direction;
    this.hot = hot;
    this.dom.style.cursor = "grabbing";
    return true;
  }

  move(e: PointerEvent) {
    const drag = this.drag;
    if (!drag || !this.state.normal || this.fields) return; // typed degrees hold the arc: the mouse is ignored
    const pixels = new THREE.Vector2(e.clientX - drag.x, e.clientY - drag.y).dot(drag.sidePx);
    this.live = tiltFromDrag(drag.direction, drag.side, this.state.normal, pixels, ARM_PX * SPHERE);
    this.state.set(this.live);
  }

  /** Whether degrees are being typed for the arc held. */
  get typing(): boolean {
    return this.fields !== null;
  }

  /** Keyboard entry while an arc is held: digits, "." and "-" type the tilt in degrees from the face normal (the sign is the way along the arc), Backspace edits,
   *  Enter applies it, Escape goes back to the mouse and then cancels the drag. Returns whether the key was used. */
  key(e: { key: string }): boolean {
    const drag = this.drag;
    if (!drag) return false;
    if (e.key === "Enter") {
      const degrees = this.fields?.value(0) ?? null;
      if (degrees !== null && this.state.normal) this.state.set(typedTiltKeeping(this.state.normal, drag.baseSide, drag.otherSide, drag.start, degrees * drag.sign));
      this.end();
      return true;
    }
    if (e.key === "Escape") {
      if (this.fields && !this.released) {
        this.fields = null; // the button is still down: back to dragging
        return true;
      }
      this.cancel();
      return true;
    }
    const fields = this.fields ?? new TypedFields(1);
    if (!fields.key(e.key)) return false;
    if (!this.fields && this.state.normal) drag.sign = tiltAlong(this.state.normal, drag.baseSide, this.live ?? this.state.dir) < -0.05 ? -1 : 1;
    this.fields = fields;
    return true;
  }

  /** Abandon the arc being held: the direction goes back to what it was. */
  cancel() {
    if (!this.drag) return;
    this.state.set(this.drag.start);
    this.end();
  }

  private end() {
    this.drag = null;
    this.live = null;
    this.hot = null;
    this.fields = null;
    this.released = false;
    this.dom.style.cursor = "";
  }

  up() {
    if (this.fields) {
      this.released = true; // typing overrides the drag: Enter applies and Escape cancels
      return;
    }
    this.drag = null;
    this.live = null;
    this.hot = null;
    this.dom.style.cursor = "";
  }
}
