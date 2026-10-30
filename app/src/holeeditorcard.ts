/** Opens the Hole Editor when a hole is selected and connects it to the tool form that carries its fields.
 *
 *  The host is chosen here: the editor is drawn as the header of the floating tool form (`ToolPanel.openForm` with `card`), which sits in
 *  the push/pull card's slot. The content (holeeditor.ts, holediagram.ts, holepresets.ts) knows nothing of that, so a docked side panel
 *  can later show the same header and the same tool forms; only this file and the `card` flag of the form would change. */
import type { Sel } from "./viewport";
import type { ToolInfo } from "./tools.ts";
import type { ToolPanel } from "./toolpanel.ts";
import { buildHoleEditor, sectionsFor, type HoleKind, type HoleSection } from "./holeeditor.ts";

export interface HoleEditorDeps {
  toolPanel(): ToolPanel;
  tools(): ToolInfo[];
  /** The core's answer for the selection: what the Hole Editor makes of it. */
  classify(sels: Sel[]): Promise<{ kind: string; count?: number }>;
  selection(): Sel[];
  /** A tool the user armed, or a sketch open: no card then. */
  busy(): boolean;
}

export function createHoleEditor(d: HoleEditorDeps) {
  let sections: HoleSection[] = [];

  function openSection(section: HoleSection) {
    const tool = d.tools().find((t) => t.id === section.tool);
    if (tool) d.toolPanel().openForm(tool, {}, "other", undefined, true);
  }

  return {
    /** Open the editor for the selection when it is one hole (picked by one face, rim or center dot) or several holes (picked by their walls). */
    async maybeOpen(sels: Sel[]) {
      if (!sels.length || d.busy() || d.toolPanel().isOpen) return;
      let reply: { kind: string; count?: number };
      try {
        reply = await d.classify(sels);
      } catch {
        return; // the card is a convenience; the tools still work
      }
      if (d.selection() !== sels || d.busy() || d.toolPanel().isOpen) return; // the selection moved on or a tool started while the core answered
      if (reply.kind === "hole" && sels.length !== 1) return; // one hole picked by several faces: the tools take one pick
      if (reply.kind !== "hole" && reply.kind !== "holes") return;
      sections = sectionsFor(reply.kind as HoleKind, reply.count ?? 1);
      if (sections.length) openSection(sections[0]);
    },
    /** The header drawn above the fields of a tool opened as a card (null for a tool that has no section). */
    header(tool: ToolInfo): HTMLElement | null {
      if (!sections.some((s) => s.tool === tool.id)) return null;
      return buildHoleEditor({
        sections,
        active: tool.id,
        choose: openSection,
        fill: (values) => d.toolPanel().setValues(values),
        focus: (param) => d.toolPanel().focusField(param),
      });
    },
  };
}
