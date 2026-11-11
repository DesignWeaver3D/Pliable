/** Drawing-style dimension leaders over the viewport, from the `dimensions` in the core's `measure` reply. */
import * as THREE from "three";
import { NS, type V, HIT_STYLE, type Box, recolour, lineHalo } from "./dimensionsvg.ts";
import { drawAngle, drawLeader, drawLinear, drawTag } from "./dimensiondraw.ts";
import { lineHits } from "./dimensioninteract.ts";

/** What the core says an in-place edit of this dimension means (see `dimedit.py`); `blocked` is why it would fail. */
export interface DimEdit {
  kind: string;
  value: number | null;
  canFlip: boolean;
  blocked?: string;
}

export interface Dimension {
  kind: "linear" | "diameter" | "radius" | "tag" | "angle";
  text: string;
  /** Angle: the point where the lines meet, then points along the arc from one line to the other. */
  points: number[][];
  /** Angle: extension segments (a start and an end point) that carry a line out to the arc. */
  extend?: number[][][];
  offsetDirection?: number[];
  /** Set when double-clicking the text edits the value in place. */
  edit?: DimEdit;
  /** Why the value cannot be edited (the tooltip of a read-only measured dimension). */
  editNote?: string;
  /** The sketch constraint this dimension shows (sketch dimensions only). */
  constraint?: number;
  /** Set when double-clicking the text or the dimension's lines runs this (the sketch's own inline editor), given where the text is. */
  activate?: (at: { x: number; y: number }) => void;
  /** Linear: how far the dimension line sits from the measured points, signed along `offsetDirection` (world units); the pixel default when unset. */
  offset?: number;
  /** Linear: how far the text is slid along the dimension line from its middle (world units). */
  slide?: number;
  /** Leaders: where the leader bends and ends (a world point); the default direction and length when unset. */
  labelAt?: number[];
  /** Set when the dimension can be dragged to a new place: called with the pointer while it is dragged. */
  drag?: (e: PointerEvent) => void;
  /** Sketch dimensions: drawn highlighted when selected, a click on the text selects it, and a right-click on the text opens its menu. */
  /** Not a dimension value: a constraint tag (H, V, =) or a live size tag while drawing. Its lines are not cut around it. */
  mark?: boolean;
  /** Tags: world points (arc and circle centers) the tag is moved clear of, so it never covers them or their selection highlight. */
  avoid?: number[][];
  /** Tags: the constraint button whose icon is drawn instead of the text. */
  icon?: string;
  /** Tags with an icon: a world direction the icon is turned to, so the icon's vertical centerline lies along it (the mirror line of a symmetric constraint). */
  iconAlong?: number[];
  /** Tags with an icon that is not the same turned half a turn: a world direction the icon's right-hand side faces. */
  iconFacing?: number[];
  /** Drawn in the reference gray (a measure-only dimension, or a size shown while a shape is drawn). */
  reference?: boolean;
  /** Tags: a world direction the tag is moved along (a fixed distance on the screen), such as out of the profile. */
  outward?: number[];
  /** Tags: other world directions to try, in order, when the outward place is taken by another mark. */
  alternatives?: number[][];
  selected?: boolean;
  select?: (e: MouseEvent) => void;
  menu?: (e: MouseEvent) => void;
}

export class DimensionOverlay {
  private readonly svg = document.createElementNS(NS, "svg");
  dims: Dimension[] = [];
  pointer: V | null = null;
  /** Called when the text of an editable dimension is double-clicked (or clicked, when it is the only dimension). */
  onActivate: ((index: number, at: { x: number; y: number }) => void) | null = null;
  /** Index of the dimension whose text an inline field is covering right now. */
  editing: number | null = null;
  private labelAt = new Map<number, V>(); // where each interactive label was drawn last frame

  constructor(
    container: HTMLElement,
    private readonly camera: () => THREE.Camera,
  ) {
    this.svg.setAttribute("style", "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden");
    container.append(this.svg);
    // The wheel zooms the view even with the pointer over a dimension or a mark (their hit areas cover the canvas): hand it to the canvas.
    this.svg.addEventListener("wheel", (e) => {
      const canvas = container.querySelector("canvas");
      if (!canvas) return;
      e.preventDefault();
      canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey }));
    }, { passive: false });
    window.addEventListener("pointermove", (e) => {
      const r = this.svg.getBoundingClientRect();
      this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
  }

  current = 0; // index of the dimension being drawn
  drewLabel: V | null = null; // where its interactive label went
  placed: Box[] = []; // text boxes of the dimensions drawn so far this frame
  pending: Box[] = [];
  clash = false;
  private drawn = ""; // what the SVG currently shows (camera, size, pointer, dimensions); unchanged means skip the redraw

  /** Called when the dimensions are replaced while an inline editor is open (the selection changed under it). */
  onReset: (() => void) | null = null;

  set(dims: Dimension[]) {
    if (this.editing !== null) this.onReset?.();
    this.dims = dims;
    this.drawn = "";
    if (dims.length === 0) this.svg.replaceChildren();
  }

  /** Redraw for the current camera; called every frame, cheap when there is nothing to show. */
  draw() {
    if (this.dims.length === 0) return;
    const rect = this.svg.getBoundingClientRect();
    const cam = this.camera();
    cam.updateMatrixWorld();
    // The pointer only matters to labels that dodge it; the interactive ones (editable or explained) stay put under it.
    const dodging = this.dims.some((d) => !d.edit && !d.editNote && !d.activate && !d.drag && !d.select);
    const state = [...cam.matrixWorld.elements, ...(cam as THREE.PerspectiveCamera).projectionMatrix.elements, rect.width, rect.height, dodging ? this.pointer?.x : 0, dodging ? this.pointer?.y : 0, this.editing].join(",");
    if (state === this.drawn) return; // nothing moved: rebuilding the SVG every frame made it flicker
    this.drawn = state;
    const project = (p: number[]): V => {
      const n = new THREE.Vector3(p[0], p[1], p[2]).project(this.camera());
      return { x: ((n.x + 1) / 2) * rect.width, y: ((1 - n.y) / 2) * rect.height };
    };
    const parts: SVGElement[] = [HIT_STYLE.cloneNode(true) as SVGElement];
    this.placed = [];
    this.labelAt = new Map();
    for (const [index, d] of this.dims.entries()) {
      this.current = index;
      this.drewLabel = null;
      // A dimension whose text would land on one already drawn is left out; the measurement panel still lists it.
      const mine: SVGElement[] = [];
      this.pending = [];
      this.clash = false;
      try {
        if (d.kind === "linear") drawLinear(this, d, project, mine);
        else if (d.kind === "tag") drawTag(this, d, project, mine);
        else if (d.kind === "angle") drawAngle(this, d, project, mine);
        else drawLeader(this, d, project, mine);
      } catch (e) {
        console.error("A dimension could not be drawn and was skipped:", d, e);
        continue;
      }
      if (this.clash) continue;
      if (d.reference) for (const el of mine) recolour(el);
      const halos = mine.filter((el) => el.tagName === "line").map(lineHalo);
      if (d.activate || d.drag) mine.push(...lineHits(this, d, mine));
      if (this.drewLabel) this.labelAt.set(index, this.drewLabel);
      parts.push(...halos, ...mine);
      this.placed.push(...this.pending);
    }
    this.svg.replaceChildren(...parts);
  }

  iconTurn = 0; // degrees the icon of the tag being drawn is turned by

  lastTap: { time: number; x: number; y: number; key: string | number } | null = null;
  activatedAt = 0;
  tapDown: { x: number; y: number } | null = null;

  /** Where the label of the dimension showing a sketch constraint was drawn last frame. */
  labelOfConstraint(id: number): { x: number; y: number } | null {
    for (const [index, p] of this.labelAt) if (this.dims[index]?.constraint === id) return p;
    return null;
  }

  /** Screen positions of the editable dimensions drawn last frame, in dimension order (for Tab to cycle through). */
  editableLabels(): { index: number; x: number; y: number }[] {
    return [...this.labelAt].filter(([i]) => this.dims[i].edit).map(([index, p]) => ({ index, x: p.x, y: p.y }));
  }

  dimension(index: number): Dimension | undefined {
    return this.dims[index];
  }

}
