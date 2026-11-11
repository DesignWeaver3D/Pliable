/** The names the sketch tools share: the tool ids and their strip entries, what the sketch asks of the app around it, a snapped click, and a point drag. Imports no sketch module, so any of them may import this one. */
import type { MeshData } from "./client.ts";

export type Tool = "select" | "line" | "rectangle" | "rectcentre" | "circle" | "circle3" | "arc" | "arc3" | "arctan" | "arcrad" | "tancircle" | "tanarc" | "slot" | "point" | "polygon" | "ellipse" | "ellarc" | "spline" | "trim" | "extend" | "split" | "fillet" | "chamfer" | "triangle" | "pentagon" | "hexagon" | "octagon";

export const SKETCH_TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: "select", label: "Select", hint: "Click to select, drag points, Delete removes" },
  { id: "line", label: "Line", hint: "Click points; Enter or right-click ends the chain" },
  { id: "rectangle", label: "Rectangle", hint: "Click two opposite corners; square, rounded or bevelled corners and their size are chosen in the sketch card" },
  { id: "rectcentre", label: "Center rectangle", hint: "Click the center, then a corner; square, rounded or bevelled corners and their size are chosen in the sketch card" },
  { id: "circle", label: "Circle", hint: "Click the center, then a point on the circle" },
  { id: "circle3", label: "Circle by 3 points", hint: "Click three points the circle passes through" },
  { id: "arc", label: "Arc", hint: "Click the center, the start, then the end; the arc runs the way the pointer moves from the start" },
  { id: "arc3", label: "Arc by 3 points", hint: "Click the start, the end, then a point the arc passes through" },
  { id: "arcrad", label: "Arc by ends and radius", hint: "Set the radius in the sketch card, click the start and the end, then a point on the side the arc bulges to; of the arcs of that radius the one nearest the pointer is made" },
  { id: "tancircle", label: "Circle tangent to curves", hint: "Pick three lines, arcs or circles to touch (the circle nearest your last click is made), or two and then click empty space for a circle of the radius in the sketch card" },
  { id: "tanarc", label: "Arc tangent to curves", hint: "Pick two lines, arcs or circles, then click where the arc goes; its radius is set in the sketch card" },
  { id: "arctan", label: "Tangent arc", hint: "Click the end of a line or arc (or the curve itself), then the end of the new arc, which leaves the curve tangentially" },
  { id: "slot", label: "Slot", hint: "Click the center of one end, the center of the other end, then a point for the width" },
  { id: "point", label: "Point", hint: "Click to place a point; it can be snapped to and constrained" },
  { id: "ellipse", label: "Ellipse", hint: "Click the center, the end of the long axis, then a point for the short radius" },
  { id: "ellarc", label: "Ellipse arc", hint: "Click the center, the end of the long axis, a point for the short radius, then the start and the end of the arc; the arc runs the way the pointer moves from the start" },
  { id: "spline", label: "Spline", hint: "Click points the curve passes through; Enter or right-click ends it, clicking the first point closes it" },
  { id: "trim", label: "Trim", hint: "Click a line to cut it at its crossings and mark that piece; click the marked piece again to delete it" },
  { id: "split", label: "Split", hint: "Click a line, an ellipse or an elliptical arc where it should be cut" },
  { id: "fillet", label: "Fillet", hint: "Click a corner where two lines or arcs meet (or one of its curves), or pick two curves, to round it; the radius is set in the sketch card" },
  { id: "chamfer", label: "Chamfer", hint: "Click a corner where two lines or arcs meet (or one of its curves), or pick two curves, to bevel it; the distance is set in the sketch card" },
  { id: "extend", label: "Extend", hint: "Click near the end of a line to stretch it to the next curve" },
  { id: "polygon", label: "Polygon", hint: "Click the center, then a corner; the number of sides is set in the sketch card (3 to 64)" },
];

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
  /** The sketch axes (0 horizontal, 1 vertical) the click landed on, both at the origin: the new point is held on them. */
  axes?: number[];
  /** A circle being drawn touches this entity (set by the circle tool's tangent snap). */
  tangent?: number;
  /** Dotted guide lines to show: the cursor lined up with existing points. */
  guides?: [number, number][][];
}

export type Drag = { point: number; u: number; v: number } | { points: { point: number; u: number; v: number }[] };
