/** The selection: what a click, a box or a row pick changes on the page, and the core's answers about it. Moved out of main.ts. */
import type { MeshData } from "./client";
import type { CoreClient } from "./client";
import type { DimensionOverlay } from "./dimensions";
import type { MeasurePanel, MeasureReply } from "./measure";
import type { NavCube } from "./navcube";
import type { Viewport, Sel } from "./viewport";
import type { ToolPanel } from "./toolpanel";
import type { RowRef } from "./listdelete";
import { app } from "./appstate";
import { isArrayTool } from "./arrayprompt";
import { clickAway } from "./toolclickaway";
import { withoutDraftTag } from "./dimedit";
import { materialOrDefault, ownDensities } from "./materials";
import { relatedState, type RelatedRule } from "./relatedrules";
import { settings } from "./settings";
import { bodiesOf } from "./visibility";

export interface SelectionDeps {
  viewport: Viewport;
  core: CoreClient;
  navCube: NavCube;
  measurePanel: MeasurePanel;
  dimensionOverlay: DimensionOverlay;
  selected: HTMLElement;
  /** Built after this module is made, so read at call time. */
  readonly toolPanel: ToolPanel;
  readonly bodyList: { setSelected(ids: number[]): void };
  renderChips(): void;
  renderToolbar(): void;
  renderSketchBar(): void;
  settleOpenArray(): Promise<"apply" | "discard" | null>;
  dropPendingProfile(): Promise<void>;
  setChosenSketch(id: number | null): void;
  pickRow(row: RowRef | null): void;
  refreshSelectionHandles(): Promise<void>;
  logOnce(kind: string, e: unknown): void;
  /** The selection and the core's answers about it are in place: a tool waiting for a selection may start. */
  selectionSettled(): void;
}

export function createSelection(d: SelectionDeps) {
  const { viewport, core, navCube, measurePanel, dimensionOverlay, selected, renderChips, renderToolbar, renderSketchBar, dropPendingProfile, setChosenSketch, pickRow, refreshSelectionHandles, logOnce } = d;

  function setSelection(sels: Sel[]) {
    if (isArrayTool(d.toolPanel.openToolId)) {
      // Clicking empty space away from an array being edited applies it, like any other open tool; the click itself is not carried over (the preview's ids are not the model's).
      if (clickAway(sels) === "ignore") { viewport.selectItems(app.currentSels); return; } // another item: the form stays open
      if (!app.askingArray) void d.toolPanel.apply();
      return;
    }
    if (d.toolPanel.isOpen && clickAway(sels) === "ignore") { viewport.selectItems(app.currentSels); return; } // another item: the open tool card stays as it is
    // The picked region stays a pick while it is still selected, alone or with an edge or global axis added to it (Revolve face from a sketch).
    if (app.pendingProfile && (app.committed !== app.pendingProfile.mesh || !app.pendingProfile.faces.every((f) => sels.some((s) => s.kind === "face" && s.id === f)) || sels.some((s) => s.kind === "face" ? !app.pendingProfile!.faces.includes(s.id) : s.kind !== "edge" && s.kind !== "axis"))) {
      if (app.committed === app.pendingProfile.mesh && !d.toolPanel.isOpen) void dropPendingProfile(); // clicked away from the picked region: it was only a pick
      else app.pendingProfile = null; // a tool used it, or the history moved on
    }
    if (d.toolPanel.isOpen) { // a click on empty space applies the open tool card (to the selection it was opened on); another item leaves it open; the click itself is not carried over
      void d.toolPanel.apply();
      return;
    }
    viewport.pullDirection.reset(); // a chosen push/pull direction belongs to the face it was chosen for
    if (sels.length === 0 && !app.keepingChosen) setChosenSketch(null); // a click on empty space lets the chosen sketch go
    if (sels.length && app.pickedRow) pickRow(null); // a body or face was picked: the Delete key leaves the sketch and datum rows
    if (d.toolPanel.isOpen) d.toolPanel.close(false); // the selection changed under an open tool form
    viewport.manipulator.clear();
    app.currentSels = sels;
    navCube.fitSelectedButton.disabled = sels.length === 0;
    d.bodyList.setSelected(sels.filter((s) => s.kind === "body").map((s) => s.id));
    app.refined = null;
    relatedState.rules = [];
    selected.textContent = describe(sels);
    if (sels.length === 0) {
      measurePanel.hide();
      app.measuredDims = []; app.previewDimsShown = false; dimensionOverlay.set([]);
      renderChips();
      renderToolbar();
      d.toolPanel.renderList();
      renderSketchBar();
      // The core knows which tools make sense with nothing selected (whole-model tools need a single body).
      core
        .request<{ tools: string[] }>("available_tools", { selection: selectionPayload(sels) })
        .then((reply) => {
          if (app.currentSels !== sels) return;
          app.refined = reply.tools;
          renderToolbar();
          d.toolPanel.renderList();
        })
        .catch((e) => logOnce("available tools", e));
      return;
    }
    // Wait for the core's answers and render once: rendering the count-only guess first, then the refined set,
    // made tools flip between enabled and grayed and the chips blink on every face click.
    const rules = sels.length === 1 && sels[0].kind === "face" ? core.request<{ rules: RelatedRule[] }>("related", { face: sels[0].id }) : Promise.resolve({ rules: [] as RelatedRule[] });
    const available = core.request<{ tools: string[] }>("available_tools", { selection: selectionPayload(sels) });
    Promise.allSettled([rules, available]).then(([rulesReply, availableReply]) => {
      if (app.currentSels !== sels) return; // the selection changed while waiting
      relatedState.rules = rulesReply.status === "fulfilled" ? rulesReply.value.rules : [];
      app.refined = availableReply.status === "fulfilled" ? availableReply.value.tools : null;
      void refreshSelectionHandles();
      renderChips();
      renderToolbar();
      d.toolPanel.renderList();
      renderSketchBar();
      d.selectionSettled();
    });
    core
      .request<MeasureReply>("measure", { selection: selectionPayload(sels), density: materialOrDefault(settings.material).density, densities: ownDensities(app.committed ? bodiesOf(app.committed) : []) }) // the density gives a selected body its mass
      .then((reply) => {
        // Not while a drag is live (the panel is hidden then); never on a stale dragSels left by a drag that failed to end.
        if (app.currentSels === sels && !viewport.dragging) {
          measurePanel.show(reply);
          app.measuredDims = withoutDraftTag(reply.dimensions ?? []);
          app.previewDimsShown = false;
          dimensionOverlay.set(app.measuredDims);
        }
      })
      .catch((e) => {
        logOnce("measurement", e);
        if (app.currentSels === sels) {
          measurePanel.hide();
          app.measuredDims = []; app.previewDimsShown = false; dimensionOverlay.set([]);
        }
      });
  }

  function selectionPayload(sels: Sel[]) {
    const ids = (kind: Sel["kind"]) => sels.filter((s) => s.kind === kind).map((s) => s.id);
    return { faces: ids("face"), edges: ids("edge"), vertices: ids("vertex"), bodies: ids("body"), axes: ids("axis"), ...(app.chosenSketch === null ? {} : { rail: app.chosenSketch }) }; // rail: the kept sketch chosen as a path
  }

  function describe(sels: Sel[]): string {
    if (sels.length === 0) return "";
    if (sels[0].kind === "body") {
      const name = (id: number) => (app.committed ? bodiesOf(app.committed).find((b) => b.id === id)?.name : undefined) ?? `body ${id}`;
      return sels.length === 1 ? name(sels[0].id) : `${sels.length} bodies`;
    }
    const axes = sels.filter((s) => s.kind === "axis");
    if (axes.length) return [describe(sels.filter((s) => s.kind !== "axis")), ...axes.map((s) => `${"XYZ"[s.id]} axis`)].filter(Boolean).join(" + "); // a global axis beside a face
    return sels.length === 1 ? `${sels[0].kind} ${sels[0].id}` : `${sels.length} ${sels[0].kind}s`;
  }

  /** The selection a reply says the old selection maps to. */
  function mappedSelection(mesh: MeshData): Sel[] {
    const s = mesh.header.selection ?? {};
    const result: Sel[] = [];
    for (const [key, kind] of [["faces", "face"], ["edges", "edge"], ["vertices", "vertex"], ["bodies", "body"], ["axes", "axis"]] as const) {
      for (const id of s[key] ?? []) result.push({ kind, id });
    }
    return result;
  }

  return { setSelection, selectionPayload, describe, mappedSelection };
}
