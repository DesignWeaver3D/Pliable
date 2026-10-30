/** Opens the Hole Editor when a hole is selected and connects it to the tool form that carries its fields.
 *
 *  The host is chosen here: the editor is drawn as the header of the floating tool form (`ToolPanel.openForm` with `card`), which sits in
 *  the push/pull card's slot. The content (holeeditor.ts, holediagram.ts, holepresets.ts) knows nothing of that, so a docked side panel
 *  can later show the same header and the same tool forms; only this file and the `card` flag of the form would change. */
import type { Sel } from "./viewport";
import type { ToolInfo } from "./tools.ts";
import type { ToolPanel } from "./toolpanel.ts";
import { threadSizeNames } from "./holethreadsizes.ts";
import { buildHoleEditor, sectionsFor, type HoleEditorView, type HoleKind, type HolePick, type HoleSection } from "./holeeditor.ts";
import { featuresOf, FEATURES_TOOL, hiddenFields, resolveEnds } from "./holefeatures.ts";

/** A new hole starts at this diameter (the form's own 0 means "leave the size" for an existing hole). */
const NEW_HOLE_DIAMETER = 6;

export interface HoleEditorDeps {
  toolPanel(): ToolPanel;
  tools(): ToolInfo[];
  /** The core's answer for the selection: what the Hole Editor makes of it. */
  classify(sels: Sel[]): Promise<{ kind: string; count?: number; pick?: HolePick }>;
  selection(): Sel[];
  /** A tool the user armed, or a sketch open: no card then. */
  busy(): boolean;
}

export function createHoleEditor(d: HoleEditorDeps) {
  let sections: HoleSection[] = [];
  let kind: HoleKind | null = null;
  let view: HoleEditorView | null = null; // the header now shown (its picture is redrawn as features are switched)

  function openSection(section: HoleSection) {
    const tool = d.tools().find((t) => t.id === section.tool);
    if (tool) d.toolPanel().openForm(tool, section.tool === FEATURES_TOOL && kind === "new" ? { diameter: NEW_HOLE_DIAMETER } : {}, "other", undefined, true);
  }

  /** Open the sections the core's answer calls for; false when the answer is not a hole or a flat face for one. Only `explicit` (the user chose Hole Editor) opens a new hole. */
  function show(reply: { kind: string; count?: number; pick?: HolePick }, sels: Sel[], explicit: boolean): boolean {
    if (reply.kind === "hole" && sels.length !== 1) return false; // one hole picked by several faces: the tools take one pick
    if (reply.kind !== "hole" && reply.kind !== "holes" && !(explicit && reply.kind === "new")) return false;
    sections = sectionsFor(reply.kind as HoleKind, reply.count ?? 1, reply.pick);
    kind = reply.kind as HoleKind;
    if (!sections.length) return false;
    openSection(sections[0]);
    if (reply.kind === "new") d.toolPanel().setValues({}); // a new hole is previewed at once
    return true;
  }

  return {
    /** Open the editor for the selection when it is one hole (picked by one face, rim or center dot) or several holes (picked by their walls). */
    async maybeOpen(sels: Sel[]) {
      if (!sels.length || d.busy() || d.toolPanel().isOpen) return;
      let reply: { kind: string; count?: number; pick?: HolePick };
      try {
        reply = await d.classify(sels);
      } catch {
        return; // the card is a convenience; the tools still work
      }
      if (d.selection() !== sels || d.busy() || d.toolPanel().isOpen) return; // the selection moved on or a tool started while the core answered
      show(reply, sels, false);
    },
    /** The user chose Hole Editor: edit the selected hole(s) or start a new hole on the selected flat face. Returns why not, or null. */
    async start(sels: Sel[]): Promise<string | null> {
      let reply: { kind: string; count?: number; pick?: HolePick };
      try {
        reply = await d.classify(sels);
      } catch (e) {
        return (e as Error).message;
      }
      if (d.selection() !== sels) return null; // the selection moved on while the core answered
      return show(reply, sels, true) ? null : "Hole Editor: select a flat face for a new hole, or a hole to edit it";
    },
    /** The header drawn above the fields of a tool opened as a card (null for a tool that has no section). */
    header(tool: ToolInfo): HTMLElement | null {
      if (!sections.some((s) => s.tool === tool.id)) return null;
      view = buildHoleEditor({
        sections,
        active: tool.id,
        choose: (section) => {
          openSection(section);
          d.toolPanel().setValues({}); // a chosen section shows its preview at once (the card opened on a selection shows none)
        },
        fill: (values) => d.toolPanel().setValues(values),
        focus: (param) => d.toolPanel().focusField(param),
        threadNames: threadSizeNames(d.tools()),
      });
      return view.element;
    },
    /** The one form's fields after the field `changed` was changed (undefined: the form just opened or a preset filled it): the values the switches force, the fields to hide, and the picture redrawn. Null for the other forms. */
    form(tool: ToolInfo, values: Record<string, unknown>, changed?: string): { set: Record<string, number>; hidden: string[] } | null {
      if (tool.id !== FEATURES_TOOL || (kind !== "new" && kind !== "hole")) return null;
      const set = changed ? resolveEnds(changed, values, kind) : {};
      const now = { ...values, ...set };
      view?.draw(featuresOf(now));
      return { set, hidden: hiddenFields(kind, now) };
    },
  };
}
