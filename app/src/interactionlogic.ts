/** The body interaction setting ("This body" / "Other bodies") of the tools that can touch other bodies: what the user chose, what the core reports, and when
 *  the control shows. Pure state, no DOM (interactionchoice.ts draws it). The core decides what each value does (docs/decisions-log.md, 2026-11-10). */
export type Interact = "this" | "others";

/** The `interact` field of a tool_preview, tool_commit or tool_handles reply: the value in force and the values offered (one when there is no choice). */
export interface InteractReport {
  value: Interact;
  options: Interact[];
}

export const INTERACT_LABELS: Record<Interact, string> = { this: "This body", others: "Other bodies" };
export const INTERACT_TITLE = "Other bodies: also merge into and cut visible bodies the change touches. Hidden and locked bodies are always skipped.";

export class InteractionState {
  /** What the user picked, or null while not chosen (the tool's default applies). */
  chosen: Interact | null = null;
  /** The last reply's setting, or null when the tool has none. */
  report: InteractReport | null = null;
  private readonly listeners = new Set<() => void>();

  /** Calls `fn` after any change; returns the function that stops it. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    for (const fn of [...this.listeners]) fn();
  }

  /** The value to show: the user's choice, else what the core reports, else the tool's default. */
  effective(fallback: Interact | null): Interact | null {
    return this.chosen ?? this.report?.value ?? fallback;
  }

  /** Whether the control shows: the tool has the setting and the core does not say the choice is not offered. */
  visible(toolDefault: Interact | null | undefined): boolean {
    if (!toolDefault) return false;
    return !this.report || this.report.options.length >= 2;
  }

  choose(value: Interact) {
    this.chosen = value;
    this.changed();
  }

  /** The reply's `interact` field (absent: the tool has no setting). */
  setReport(report: InteractReport | null | undefined) {
    this.report = report ?? null;
    this.changed();
  }

  /** The tool opened, was applied, cancelled or closed: the choice is forgotten and the default applies. */
  reset() {
    if (this.chosen === null) return;
    this.chosen = null;
    this.changed();
  }

  /** The value sent with a request: only a choice the user made, else nothing (the core uses the tool's default). */
  sent(): Interact | null {
    return this.chosen;
  }
}

export const interaction = new InteractionState();
