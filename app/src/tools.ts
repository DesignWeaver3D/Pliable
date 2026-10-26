// Client-side view of the core's tool registry (see docs/protocol.md, `list_tools`).

import type { Sel } from "./viewport";

type Range = [number, number | null];

export interface ToolInfo {
  id: string;
  label: string;
  /** Plain-language sentence(s) on what the tool does and what to select; shown in tooltips. */
  description?: string;
  accepts: { faces: Range; edges: Range; vertices?: Range; bodies?: Range; anyOf?: boolean };
  /** What the tool accepts instead when a kept sketch is chosen as its path (Sweep face, Array along path). */
  railAccepts?: { faces: Range; edges: Range; vertices?: Range; bodies?: Range; anyOf?: boolean };
  params: { name: string; kind: string; default: number; drag: boolean; options?: string[] }[];
  /** Relationship rules whose matching faces join the selection when switched on. */
  related?: string[];
  /** Names of three length parameters that form a point; the form offers to fill them from a reference snap. */
  placement?: string[] | null;
  /** Names of three length parameters that form a displacement; the form offers a base and a destination pick. */
  moveVector?: string[] | null;
  /** Names of the x, y, z parameters of a picked axis point and of the choice list that selects it; the form offers a Pick axis button (Draft). */
  pickAxis?: string[] | null;
  pickEdge?: string[] | null;
  pickPlane?: string[] | null;
  /** "tool": the tool is chosen first and places something new; "selection": it acts on a selection. */
  startsFrom?: "selection" | "tool";
  hasHandles?: boolean;
  /** Kept only so old documents and requests work: not offered in the strip or the tool list. */
  hidden?: boolean;
}

/** An on-screen manipulator for one parameter (docs/protocol.md, Handles). */
export interface HandleInfo {
  param: string;
  label: string;
  anchor: [number, number, number];
  direction: [number, number, number];
  /** Parameter change per model unit of handle travel. */
  scale: number;
  min: number | null;
  max: number | null;
  /** A yes/no marker (0 or 1): clicking flips the value instead of dragging. */
  toggle: boolean;
  /** How it is drawn: a plain arrow, a move arrow in its axis colour, a square resize grip, or a click marker. */
  kind?: "arrow" | "move" | "resize" | "toggle";
  unit: string;
  /** An axis handle: the other end of the line drawn from here (a hole's opening), or null. */
  axisFrom?: [number, number, number] | null;
  /** A rotation handle: the axis it turns about (it is drawn in that axis's colour) and the ring it runs on: centre and radius. */
  axis?: [number, number, number] | null;
  ring?: [number, number, number, number] | null;
  /** A rotation handle: the angles (degrees) the drag snaps to when it passes close to one. */
  snaps?: number[];
  /** A rotation handle drawn as a short arc about the thing it turns (like the push/pull direction arcs) instead of a whole ring with a grip. */
  arc?: boolean;
  /** A move arrow whose label shows the distance moved along it, not its parameter. */
  along?: boolean;
  /** What each snap angle is ("face", "global axes"), in the order of `snaps`. */
  snapNames?: string[];
  /** The parameter of the arc that turns this handle: the view swings it while that arc is dragged. */
  turnedBy?: string;
  /** A grid grip: the grid's two step vectors. Dragged in their plane it sets this parameter (whole steps along the first) and the first linked parameter (along the second) independently. */
  plane?: [[number, number, number], [number, number, number]] | null;
  /** The x and y axes of the sketch plane on the handle's face (push/pull's direction gizmo swings about them). */
  frame?: [[number, number, number], [number, number, number]] | null;
  /** The number shown and typed is the parameter times `factor` (0.5: a diameter parameter shown as a radius), after `symbol`. */
  factor?: number;
  symbol?: string;
  /** The parameter's value when the handle was computed. */
  value: number;
  /** Other parameters that move with this one: each changes by `scale` per model unit of travel (a low box face also moves the origin). */
  links?: { param: string; scale: number; value: number }[];
}

const inRange = (n: number, [min, max]: Range) => n >= min && (max === null || n <= max);

/** Whether the selection has the counts a tool accepts. The core can still refuse it (e.g. curved faces). */
export function acceptsSelection(tool: ToolInfo, sels: Sel[]): boolean {
  const count = (kind: Sel["kind"]) => sels.filter((s) => s.kind === kind).length;
  if (tool.accepts.anyOf && sels.length === 0) return false; // "one of" tools need something selected
  return (
    inRange(count("face"), tool.accepts.faces) &&
    inRange(count("edge"), tool.accepts.edges) &&
    inRange(count("vertex"), tool.accepts.vertices ?? [0, 0]) &&
    inRange(count("body"), tool.accepts.bodies ?? [0, 0])
  );
}

function needs(range: Range, noun: string): string | null {
  const [min, max] = range;
  if (max === 0) return null;
  const count = max === null ? `${min}+` : min === max ? `${min}` : `${min}-${max}`;
  return `${count} ${noun}${max === 1 ? "" : "s"}`;
}

/** A short description of the selection a tool needs, e.g. "1 face" or "1+ edges". */
export function describeNeeds(tool: ToolInfo): string {
  const anyOf = tool.accepts.anyOf;
  const fix = (r: Range): Range => (anyOf ? [Math.max(r[0], 1), r[1]] : r);
  return [needs(fix(tool.accepts.faces), "face"), needs(fix(tool.accepts.edges), "edge"), needs(fix(tool.accepts.vertices ?? [0, 0]), "vertex"), needs(fix(tool.accepts.bodies ?? [0, 0]), "body")]
    .filter(Boolean)
    .join(anyOf ? " or " : " + ");
}

/** Tooltip for a tool button or search row: "<label>: <description> (<shortcut>)", then what the selection must hold. */
export function toolTooltip(tool: ToolInfo, shortcut = ""): string {
  const what = tool.description?.trim() || `${tool.label} (no description available)`;
  const needs = describeNeeds(tool);
  return `${tool.label}: ${what}${shortcut ? ` (${shortcut})` : ""}
${needs ? `Needs: ${needs}` : "No selection needed"}`;
}

export function dragParam(tool: ToolInfo): string | null {
  return tool.params.find((p) => p.drag)?.name ?? null;
}
