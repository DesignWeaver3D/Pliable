// Client-side view of the core's tool registry (see docs/protocol.md, `list_tools`).

import type { Sel } from "./viewport";

type Range = [number, number | null];

export interface ToolInfo {
  id: string;
  label: string;
  /** Plain-language sentence(s) on what the tool does and what to select; shown in tooltips. */
  description?: string;
  accepts: { faces: Range; edges: Range; vertices?: Range };
  params: { name: string; kind: string; default: number; drag: boolean }[];
  /** Relationship rules whose matching faces join the selection when switched on. */
  related?: string[];
  /** Names of three length parameters that form a point; the form offers to fill them from a reference snap. */
  placement?: string[] | null;
  /** Names of three length parameters that form a displacement; the form offers a base and a destination pick. */
  moveVector?: string[] | null;
  /** "tool": the tool is chosen first and places something new; "selection": it acts on a selection. */
  startsFrom?: "selection" | "tool";
  hasHandles?: boolean;
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
  /** The parameter's value when the handle was computed. */
  value: number;
}

const inRange = (n: number, [min, max]: Range) => n >= min && (max === null || n <= max);

/** Whether the selection has the counts a tool accepts. The core can still refuse it (e.g. curved faces). */
export function acceptsSelection(tool: ToolInfo, sels: Sel[]): boolean {
  const count = (kind: Sel["kind"]) => sels.filter((s) => s.kind === kind).length;
  return (
    inRange(count("face"), tool.accepts.faces) &&
    inRange(count("edge"), tool.accepts.edges) &&
    inRange(count("vertex"), tool.accepts.vertices ?? [0, 0])
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
  return [needs(tool.accepts.faces, "face"), needs(tool.accepts.edges, "edge"), needs(tool.accepts.vertices ?? [0, 0], "vertex")]
    .filter(Boolean)
    .join(" + ");
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
