/** What the sections of a tool form share: the open tool, its fields and the calls back into the tool panel. */
import type { Vec3 } from "./placepick.ts";
import type { ToolInfo } from "./tools.ts";
import type { ParamValue, ToolPanelHost } from "./toolpanel.ts";

export interface FormParts {
  tool: ToolInfo;
  host: ToolPanelHost;
  /** Values the form opens with (re-editing the last operation). */
  initial: Record<string, ParamValue>;
  /** The form is a card that opened by itself on a selection. */
  card: boolean;
  inputs: Record<string, HTMLInputElement | HTMLSelectElement>;
  /** per_edge parameters: [start, end] inputs per edge. */
  pairInputs: Record<string, HTMLInputElement[][]>;
  rowOf: Record<string, HTMLElement>;
  title: HTMLElement;
  buttons: HTMLElement;
  /** Where the picked base point is now; set by the section that picks one. */
  baseNow: (() => Vec3 | null) | null;
  /** Whether this form is still the open one (a pick in the view can outlast it). */
  isOpen(): boolean;
  /** Whether any form is open. */
  anyOpen(): boolean;
  /** Ask for a preview after the usual delay, or after `delay` milliseconds. */
  preview(delay?: number): void;
  values(): Record<string, ParamValue>;
  refreshCard(changed?: string): void;
  apply(): void;
  close(): void;
}
