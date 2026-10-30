import * as THREE from "three";
import { moveHandlesAt } from "./placepick";
import { bodyCentres, movedBodies } from "./slide";
import { PointPicker, ReferenceView } from "./reference";
import { installAlphaUi, showDiagnostics, showLaunchNotice, showMessage } from "./alpha";
import { installMessageLog } from "./messagelog";
import type { PlaneData } from "./sketchmodel";
import { CoreClient, type MeshData } from "./client";
import { SketchMode } from "./sketch";
import type { Tool as SketchTool } from "./sketch";
import { SketchBar } from "./sketchbar";
import { ToolPanel, type ParamValue } from "./toolpanel";
import { NavCube, VIEW_KEYS } from "./navcube";
import { SectionView } from "./sectionview";
import { SectionPanel } from "./sectionpanel";
import { DimensionOverlay } from "./dimensions";
import { DimensionEditor } from "./dimedit";
import { KeptSketches } from "./keptsketches";
import { acceptsWithRail } from "./sketchrail";
import { SKETCH_CONSTRAINT_KEYS } from "./sketchkeys";
import { deleteAction, isTyping, type RowRef } from "./listdelete";
import { resolvePick } from "./pulldir";
import { edgeMiddle } from "./edgepick";
import { DatumPlanes } from "./datumplanes";
import type { DatumPlane, MirrorMode } from "./datumcorners";
import { LatestWins } from "./latestwins";
import { SETTING_ENTRIES, createSettingsWindow, onSettingsChange, openSettings, setHintsBinding, setKeysOpener, settingValue, settings } from "./settings";
import { MeasurePanel, type MeasureReply } from "./measure";
import { KeyRouter } from "./keyrouter";
import { HintLine } from "./hints";
import { exportAs as saveModel, installFileOpening } from "./filesave";
import { askApplyOrDiscard, isArrayTool } from "./arrayprompt";
import { askRestore, dismissRestorePrompt } from "./restoreprompt";
import { app, bodyView } from "./appstate";
import { createToolStrip } from "./toolstrip";
import { helperSignature as helperSignatureOf, selectionHelpers as selectionHelpersOf, type HelperDeps } from "./toolhelpers";
import { expand, renderChips as chipsRender } from "./relatedrules";
import { installBodyActions } from "./bodyactions";
import { Palette, type Command } from "./palette";
import { toolKeywords } from "./search";
import { askMeshOptions } from "./meshexportdialog";
import { TOOLS_HANDLE_ICON, uiIcon } from "./icons";
import type { AnchorInfo } from "./placepick";
import { acceptsSelection, describeNeeds, dragParam, toolTooltip, type HandleInfo, type ToolInfo } from "./tools";
import { switchToTwoDistances } from "./twodistances";
import { Viewport, type Sel } from "./viewport";
import { usage, type Surface } from "./usage";
import { createWaitingTool, waitingHint } from "./toolwaiting";
import { bodiesOf } from "./visibility";
import { showNumber } from "./precision.ts";
import { createSelection } from "./selection";
import { followMeasureCard } from "./selectedreadout";
import { createModelView } from "./modelview";
import { createItemDrag } from "./itemdrag";
import { createPushPullCard } from "./pushpullwire.ts";
import { createHoleEditor } from "./holeeditorcard.ts";

const $ = (id: string) => document.getElementById(id)!;
const status = $("status");
// A warning (orange) stays only while its own text is showing; any other message replaces it.
let warnedText: string | null = null;
new MutationObserver(() => {
  if (status.classList.contains("warn") && status.textContent !== warnedText) status.classList.remove("warn");
}).observe(status, { childList: true, characterData: true, subtree: true });
const selected = $("selected");
followMeasureCard(selected, $("measure"));
const DEV = new URLSearchParams(location.search).has("dev"); // ?dev=1 shows triangle counts and timings
const latency = $("latency");
if (!DEV) latency.hidden = true;
const undoButton = $("undo") as HTMLButtonElement;
const redoButton = $("redo") as HTMLButtonElement;
const fileInput = $("file") as HTMLInputElement;
const select = $("demo") as HTMLSelectElement;
let loadedSample = [...select.options].find((option) => option.value)!.value; // the sample open now (the first one at start); also names exported files
const viewport = new Viewport($("viewport"));
const core = new CoreClient();
usage.attach(core);
installAlphaUi($("bar"), core);
installMessageLog(status, showMessage); // errors and warnings are kept for Copy diagnostics; a click on a cut-short message shows it whole

const BUSY_LABELS: Record<string, string> = {
  import_step: "Importing", combine_step: "Combining", export_step: "Exporting", export_cad: "Exporting", save_project: "Saving", open_project: "Opening", open_demo: "Opening",
  restore_session: "Restoring", tool_commit: "Applying", sketch_extrude: "Building", undo: "Undoing", redo: "Redoing",
};
const busyBox = $("busy");
const busyText = $("busytext");
core.onBusy = (busy) => {
  busyBox.hidden = busy === null;
  if (busy) busyText.textContent = `${BUSY_LABELS[busy.type] ?? "Working"}... ${Math.floor(busy.seconds)} s`;
};
const measurePanel = new MeasurePanel($("measure"));
// An edit card (under the nav cube, like the sketch card) that reaches down to the measurement card pushes it left.
{
  const cards = [$("toolform"), $("ppcard")];
  const dodge = () => {
    const m = $("measure");
    m.classList.remove("aside");
    if (cards.some((card) => !card.hidden && !m.hidden && card.getBoundingClientRect().bottom > m.getBoundingClientRect().top)) m.classList.add("aside");
  };
  const watch = new MutationObserver(dodge);
  for (const el of [...cards, $("measure")]) watch.observe(el, { attributes: true, attributeFilter: ["hidden"], childList: true, subtree: true });
  window.addEventListener("resize", dodge);
}
const dimensionOverlay = new DimensionOverlay($("viewport"), () => viewport.camera);
createSettingsWindow(document.body);
const navCube = new NavCube($("navcube"), viewport);
const reference = new ReferenceView(viewport);
const pointPicker = new PointPicker(viewport, reference, (text) => (status.textContent = text));
const seeThroughButton = $("seethrough");
const section = new SectionView(viewport, () => !toolPanel.isOpen && !viewport.interceptor);
const sectionButton = document.createElement("button");
sectionButton.id = "section";
sectionButton.append(uiIcon("section"));
sectionButton.addEventListener("click", () => (section.active ? section.close() : section.open()));
let sectionPanel: SectionPanel | undefined;
let sectionShown = false;
const syncSection = () => {
  sectionButton.classList.toggle("active", section.active);
  sectionButton.setAttribute("aria-pressed", String(section.active));
  sectionButton.title = `Section view ${section.active ? "on" : "off"}: cut the model with a plane in the view, with hatched cut faces; where bodies overlap the cut is red`;
  if (section.active !== sectionShown) {
    sectionShown = section.active;
    sectionPanel?.setOpen(sectionShown);
  }
};
navCube.group.prepend(sectionButton);
navCube.group.append(seeThroughButton, $("axes"));
seeThroughButton.addEventListener("click", () => viewport.toggleSeeThrough());
const syncSeeThrough = () => {
  seeThroughButton.classList.toggle("active", settings.seeThrough);
  seeThroughButton.setAttribute("aria-pressed", String(settings.seeThrough));
  seeThroughButton.title = `See-through ${settings.seeThrough ? "on" : "off"} (${keys.keymap.hint("display.seeThrough") || "X"}): faces transparent, hidden edges and faces can be picked`;
};
onSettingsChange(syncSeeThrough); // first call after the key router exists, below
const axesButton = $("axes");
axesButton.prepend(uiIcon("axes"));
const syncAxes = () => axesButton.classList.toggle("active", reference.visible);
axesButton.addEventListener("click", () => {
  reference.setVisible(!reference.visible);
  syncAxes();
});
syncAxes();
viewport.onFrame = () => {
  // One failing part must not stop the others from updating on later frames.
  for (const part of [() => reference.tick(), () => dimensionOverlay.draw(), () => navCube.update(), () => section.tick()]) {
    try {
      part();
    } catch (e) {
      logOnce("frame", e);
    }
  }
};
viewport.onFrameError = (message) => showError(new Error(message));
const loggedErrors = new Set<string>();
/** Console-log an error once per kind, so a failure repeating every frame does not flood the console. */
function logOnce(kind: string, e: unknown) {
  if (loggedErrors.has(kind)) return;
  loggedErrors.add(kind);
  console.error(`Pliable ${kind} update failed (later updates continue):`, e);
}

// Tool registry from the core, the current selection, and which tool a drag runs.
let tools: ToolInfo[] = [];
let armedTool: string | null = null; // tool the user chose in the toolbar or palette
const waitingTool = createWaitingTool(); // a tool chosen from the drawer before its selection exists

/** The tool the chips speak for: the armed tool, else the open form's tool, else none (a choice for all tools). */
function chipTool(): string | null {
  return armedTool ?? toolPanel.openToolId;
}
const chips = $("chips");
// The hint line and the tip stand above the chips instead of on top of them.
new ResizeObserver(() => document.documentElement.style.setProperty("--chips-h", `${chips.offsetHeight}px`)).observe(chips);
function renderChips() {
  chipsRender({ chips, viewport, tool: chipTool, changed: () => {
    renderToolbar();
    toolPanel.renderList();
  } });
  // While Fillet/Chamfer is armed with edges selected, a chip switches to two distances (a chamfer being created).
  if (armedTool === "fillet_chamfer" && app.currentSels.some((s) => s.kind === "edge")) {
    const two = document.createElement("button");
    two.textContent = "Two distances";
    two.title = "Bevel with a different distance on each side: switches to Chamfer (two distances), with the first face beside the edge as the reference";
    two.addEventListener("click", () => twoDistances(1));
    chips.append(two);
  }
}

/** Tools usable with the current selection: counts checked here, the core's extra checks once it replies. */
function usableTools(): ToolInfo[] {
  return tools.filter((t) => (acceptsSelection(t, expand(t, app.currentSels)) || acceptsWithRail(t, expand(t, app.currentSels), app.chosenSketch) || (t.id === "move_body" && movableSketch() !== null)) && (app.refined === null || app.refined.includes(t.id)));
}

/** Whether the selection has what the tool takes (the counts, the chosen rail or a movable sketch), whatever the core adds. */
function fitsSelection(t: ToolInfo): boolean {
  return acceptsSelection(t, expand(t, app.currentSels)) || acceptsWithRail(t, expand(t, app.currentSels), app.chosenSketch) || (t.id === "move_body" && movableSketch() !== null);
}

/** A tool chosen in the drawer: with a fitting selection it starts as usual; otherwise it waits and says what to select. */
function waitForSelection(tool: ToolInfo): boolean {
  if (fitsSelection(tool)) {
    waitingTool.cancel();
    return false;
  }
  waitingTool.wait(tool);
  status.classList.remove("error");
  status.textContent = waitingHint(tool);
  return true;
}

/** The kept sketch Move/Rotate would move: the sketch whose row was picked, or whose region was picked in the view. */
function movableSketch(): number | null {
  if (app.pickedRow?.list === "sketch") return app.pickedRow.id;
  const pending = app.pendingProfile;
  if (pending && app.committed === pending.mesh && app.currentSels.length > 0 && app.currentSels.every((s) => s.kind === "face" && pending.faces.includes(s.id))) return pending.sketchId;
  return null;
}
/** The kept sketch chosen with Shift or Ctrl+click on its curve in the view; kept beside the face and edge selection. */
function setChosenSketch(id: number | null) {
  if (app.chosenSketch === id) return;
  app.chosenSketch = id;
  keptSketches.setChosen(id);
}
/** The kept sketch the open Move/Rotate form is moving (its plane moves, see sketchmove.py); null for a body move. */
let sketchMove: number | null = null;

/** Open Move/Rotate for a sketch: the region pick that led here is taken out of the model first, then the same arrows and rings move the sketch. */
async function openSketchMove(tool: ToolInfo, id: number, surface: Surface) {
  await dropPendingProfile();
  toolPanel.openForm(tool, {}, surface); // this closes a form open before, which would reset the move below
  sketchMove = id;
  status.classList.remove("error");
  status.textContent = "Moving the sketch: drag the arrows and rings or type values, then Apply (Esc cancels)";
}

async function runSketchMovePreview(values: Record<string, ParamValue>) {
  const seq = ++formPreviewSeq;
  const id = sketchMove;
  if (id === null) return;
  try {
    const reply = await core.request<{ plane: PlaneData; handles: HandleInfo[] }>("sketch_move", { sketch_id: id, params: values });
    if (!toolPanel.isOpen || seq !== formPreviewSeq || sketchMove !== id) return; // closed or a newer preview was asked for
    keptSketches.previewPlane(id, reply.plane);
    viewport.manipulator.setHandles(moveHandlesAt(reply.handles, toolPanel.basePosition()));
    status.classList.remove("error");
  } catch (e) {
    if (seq !== formPreviewSeq) return;
    status.textContent = (e as Error).message;
    status.classList.add("error");
  }
}

/** The tool a drag on `sels` runs: the armed one if it applies, else the first with a drag parameter. */
function dragToolFor(sels: Sel[]): ToolInfo | null {
  const candidates = tools.filter((t) => dragParam(t) !== null && acceptsSelection(t, expand(t, sels)));
  return candidates.find((t) => t.id === armedTool) ?? candidates[0] ?? null;
}

/** The hole or cut tool whose axis handles show for a selected hole face or rim (or the wall of a square or slot cut) (none while a drag tool is armed). */
function holeHandleTool(sels: Sel[]): ToolInfo | null {
  if (armedTool !== null || sels.length !== 1) return null;
  const id = app.refined?.includes("edit_hole") ? "edit_hole" : app.refined?.includes("edit_void") ? "edit_void" : null; // a round hole, else a square or slot cut
  return id ? (tools.find((t) => t.id === id) ?? null) : null;
}
let selectionHandleTool: ToolInfo | null = null; // the tool the handles now shown on the selection belong to

/** With a selection and no form open, the tool a drag would run shows its handles (push/pull's arrow on the face). */
async function refreshSelectionHandles() {
  const sels = app.currentSels;
  if (viewport.interceptor) {
    viewport.manipulator.clear(); // a sketch is open: model handles would sit over it
    return;
  }
  const tool = sels.length && !toolPanel.isOpen ? (holeHandleTool(sels) ?? dragToolFor(sels)) : null;
  selectionHandleTool = tool;
  if (!tool?.hasHandles || tool.startsFrom === "tool") {
    viewport.manipulator.clear();
    return;
  }
  try {
    const reply = await core.request<{ handles: HandleInfo[] }>("tool_handles", { tool: tool.id, selection: selectionPayload(expand(tool, sels)), params: tool.id === "push_pull" ? viewport.pullDirection.params() : {} });
    if (app.currentSels !== sels || toolPanel.isOpen) return; // the selection changed or a form took over while waiting
    viewport.manipulator.setHandles(reply.handles);
  } catch {
    viewport.manipulator.clear(); // handles are a convenience; the plain drag still works
  }
}

const toolbar = $("tools");
$("drawerbtn").prepend(uiIcon(TOOLS_HANDLE_ICON, 24));

// Icons beside the labels of the top bar buttons (the label stays: icons alone are not self-explanatory).
for (const [id, name] of [["menubtn", "menu"], ["undo", "undo"], ["redo", "redo"], ["editlast", "edit"]] as const) $(id).prepend(uiIcon(name));
$("palette-input").parentElement!.insertBefore(Object.assign(uiIcon("search"), { className: "icon searchicon" }), $("palette-input"));

// File menu: model, import/export and view toggles live in one popup so the top bar stays small.
const menuPanel = $("menupanel");
$("menubtn").addEventListener("click", () => {
  menuPanel.hidden = !menuPanel.hidden;
});
menuPanel.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("button")) menuPanel.hidden = true;
});
menuPanel.addEventListener("change", (e) => {
  if (["demo", "exportmesh"].includes((e.target as HTMLElement).id)) menuPanel.hidden = true;
});
document.addEventListener("pointerdown", (e) => {
  if (!menuPanel.hidden && !(e.target as HTMLElement).closest("#menuwrap")) menuPanel.hidden = true;
}, true);

// Browse drawer: every tool by group, hidden until asked for (the left handle, key T, or the strip's "..." button). It opens and closes only from the handle or T: clicking tools or the 3D view never closes it.
const drawer = $("drawer");
function toggleDrawer(open = drawer.hidden, usableOnly?: boolean) {
  drawer.hidden = !open;
  document.documentElement.style.setProperty("--leftw", open ? "calc(492px + var(--handlew))" : "calc(212px + var(--handlew))");
  document.documentElement.style.setProperty("--drawerw", open ? "280px" : "0px"); // the drawer sits at the edge and pushes the body list over; the tool form and the measurement card sit beside both
  renderToolbar(); // the strip's room depends on the drawer
  $("drawerbtn").setAttribute("aria-expanded", String(open));
  if (usableOnly !== undefined) {
    ($("drawerusable") as HTMLInputElement).checked = usableOnly;
    drawer.classList.toggle("usableonly", usableOnly);
  }
}
$("drawerbtn").addEventListener("click", () => {
  toggleDrawer();
  menuPanel.hidden = true;
});
$("drawerusable").addEventListener("change", (e) => drawer.classList.toggle("usableonly", (e.target as HTMLInputElement).checked));



/** While a sketch is open the top strip holds the drawing tools instead of the model's tools. The sketch itself is made below. */
let currentSketchTool: () => SketchTool = () => "select";
let chooseSketchTool: (tool: SketchTool) => void = () => {};
let sketchConstraints: () => { label: string; enabled: boolean }[] = () => [];
let chooseConstraint: (label: string) => void = () => {};

const { renderToolbar } = createToolStrip({
  toolbar,
  sketchOpen: () => !!viewport.interceptor,
  sketchTool: () => currentSketchTool(),
  chooseSketchTool: (tool) => chooseSketchTool(tool),
  sketchConstraints: () => sketchConstraints(),
  chooseConstraint: (label) => chooseConstraint(label),
  drawerHidden: () => !!drawer.hidden,
  toggleDrawer: (open, usableOnly) => toggleDrawer(open, usableOnly),
  selection: () => app.currentSels,
  usableTools: () => usableTools(),
  dragToolFor: (sels) => dragToolFor(sels),
  helperSignature: () => helperSignature(),
  selectionHelpers: () => selectionHelpers(),
  renderChips: () => renderChips(),
  armTool: (tool) => armTool(tool, "strip"),
});


const helperDeps: HelperDeps = {
  core,
  status,
  committed: () => app.committed,
  selection: () => app.currentSels,
  select: (sels) => {
    viewport.selectItems(sels);
    setSelection(sels);
  },
  editPrimitive: (id) => editPrimitive(id),
  sharpAngle: () => settings.sharpAngle,
};
const helperSignature = () => helperSignatureOf(helperDeps);
const selectionHelpers = () => selectionHelpersOf(helperDeps);

/** Reopen the creation form and handles of an editable primitive body, filled with the values it was made with. */
async function editPrimitive(id: number) {
  await settleOpenArray(); // an array still being edited is applied or discarded first
  const body = app.committed ? bodiesOf(app.committed).find((b) => b.id === id) : undefined;
  const tool = body?.editable && body.recipe ? tools.find((t) => t.id === body.recipe!.tool) : undefined;
  if (!body || !tool || !body.recipe) {
    status.textContent = body?.why ?? "That body is not an editable primitive";
    return;
  }
  const picked: Sel[] = [{ kind: "body", id }];
  viewport.selectItems(picked);
  setSelection(picked);
  toolPanel.openForm(tool, body.recipe.params, "other", id);
  status.classList.remove("error");
  status.textContent = `Editing ${body.name}: change the values or drag its handles, then Apply (Esc cancels)`;
}

function armTool(tool: ToolInfo, surface: Surface) {
  waitingTool.cancel();
  if (isArrayTool(toolPanel.openToolId)) {
    void settleOpenArray().then(() => armTool(tool, surface));
    return;
  }
  const movable = tool.id === "move_body" ? movableSketch() : null;
  if (movable !== null) {
    void openSketchMove(tool, movable, surface);
    return;
  }
  if (dragParam(tool) === null) {
    toolPanel.openForm(tool, {}, surface);
    return;
  }
  usage.record(tool.id, "start", surface);
  armedTool = tool.id;
  if (tool.id === "push_pull") pushPullCard.open(); // the Push/Pull button always opens its card
  renderChips();
  void refreshSelectionHandles();
  renderToolbar();
  if (!status.classList.contains("error")) status.textContent = `${tool.label}: drag the selection`;
}

/** The model state made by picking a sketch region, while its face is still the only selection and nothing was done with it. */

/** A sketch region picked in the view becomes a temporary face of the model, selected so the usual tools work on it. */
let profilePicking: Promise<void> | null = null;
function pickProfile(sketchId: number, region: number, additive = false) {
  const run = pickProfileNow(sketchId, region, additive);
  profilePicking = run.finally(() => { if (profilePicking === run) profilePicking = null; });
  return run;
}
async function pickProfileNow(sketchId: number, region: number, additive: boolean) {
  // Shift or Ctrl adds another region of the same sketch (or takes a picked one out again): all the picked regions become faces together.
  const before = additive && app.pendingProfile && app.pendingProfile.sketchId === sketchId && app.committed === app.pendingProfile.mesh ? app.pendingProfile.regions : [];
  const regions = before.includes(region) ? before.filter((r) => r !== region) : [...before, region];
  await dropPendingProfile();
  if (!regions.length) return setSelection([]);
  try {
    const mesh = await core.request<MeshData>("sketch_regions", { sketch_id: sketchId, region: regions[0], picked_regions: regions });
    const faces: number[] = mesh.header.selection?.faces ?? [];
    setCommitted(mesh, false, faces.map((id) => ({ kind: "face" as const, id })));
    if (faces.length) app.pendingProfile = { mesh, faces, sketchId, regions };
    else {
      // Nothing came back selected (a core that was not restarted adds every region): take the faces out again so none stay in the model.
      await history("undo");
      status.textContent = "That region could not be picked; restart the core and try again";
      status.classList.add("error");
    }
  } catch (e) {
    status.textContent = (e as Error).message;
    status.classList.add("error");
  }
}

/** Take the temporary face of a picked region out of the model again (an undo of the pick). */
async function dropPendingProfile() {
  const pending = app.pendingProfile;
  app.pendingProfile = null;
  if (pending && app.committed === pending.mesh) await history("undo");
}

/** An array form that is only a preview is open: ask to apply or discard it; resolves with the answer once the form is closed, or null at once when none is open. */
async function settleOpenArray(): Promise<"apply" | "discard" | null> {
  if (!isArrayTool(toolPanel.openToolId) || app.askingArray) return null;
  app.askingArray = true;
  try {
    const answer = await askApplyOrDiscard(toolPanel.openToolLabel);
    if (answer === "apply") await toolPanel.apply();
    else toolPanel.close();
    return answer;
  } finally {
    app.askingArray = false;
  }
}


const { setSelection, selectionPayload, mappedSelection, describe } = createSelection({
  viewport, core, navCube, measurePanel, dimensionOverlay, selected,
  get toolPanel() { return toolPanel; },
  get bodyList() { return bodyList; },
  renderChips, renderToolbar, renderSketchBar, settleOpenArray, dropPendingProfile, setChosenSketch, pickRow, refreshSelectionHandles, logOnce,
  selectionSettled() {
    const tool = waitingTool.take(fitsSelection); // the selection now fits the tool chosen before it
    if (tool) armTool(tool, "drawer");
    else void holeEditor.maybeOpen(app.currentSels); // a selected hole opens the Hole Editor
  },
});

/** Tells the list of kept sketches what the document holds; set once that list exists. */
let onSketches: (list: { id: number; name: string; rev: number }[]) => void = () => {};
let onDatums: (list: DatumPlane[], mirror: MirrorMode | null) => void = () => {};

const { show, syncHistoryButtons, setCommitted } = createModelView({
  viewport, core, status, dimensionOverlay, undoButton, redoButton, dev: DEV,
  get bodyList() { return bodyList; },
  get editLastButton() { return editLastButton; },
  get sketch() { return sketch; },
  get loadedSample() { return loadedSample; },
  onSketches: (list) => onSketches(list),
  onDatums: (list, mirror) => onDatums(list, mirror),
  setChosenSketch, setSelection,
});

async function load(name: string) {
  status.textContent = `loading ${name}...`;
  setCommitted(await core.openDemo(name), true);
}

const pushPullCard = createPushPullCard({
  viewport, el: $("ppcard"), selection: () => app.currentSels, armedTool: () => armedTool,
});
const itemDrag = createItemDrag({
  viewport, core, status, latency, dimLabel: $("dim"), measurePanel, dimensionOverlay,
  get armedTool() { return armedTool; },
  dragToolFor, show, setCommitted, setSelection, selectionPayload, mappedSelection, rememberOp,
  pushPullCard,
});

viewport.onSelect = setSelection;
viewport.toolOpen = () => toolPanel.isOpen || isArrayTool(toolPanel.openToolId);

// Editing a displayed dimension in place (dimedit.ts): the core maps it to the matching tool, so it previews like one and is one undo step.
const dimensionEditor = new DimensionEditor({
  overlay: dimensionOverlay,
  container: $("viewport"),
  send: (edit, value, flip, commit) => core.request("dimension_edit", { selection: selectionPayload(app.currentSels), dimension: edit.kind, value, flip, commit }),
  preview: (reply) => {
    show(reply as MeshData);
    status.classList.remove("error");
  },
  revert: () => {
    if (app.committed) show(app.committed);
  },
  committed: (reply, summary) => {
    const mesh = reply as MeshData;
    setCommitted(mesh, false, mappedSelection(mesh));
    status.textContent = summary;
  },
});
void dimensionEditor;
viewport.onHoverBody = (id) => bodyList.setHovered(id);

// Moving a hole by dragging its center dot: previews the Move hole tool (latest request wins) and commits on release.
type CentreMove = { face: number; offset: { x: number; y: number; z: number } };
function centreRequest(face: number, o: { x: number; y: number; z: number }) {
  const tool = tools.find((t) => t.id === "move_hole");
  if (!tool) return null;
  return { tool: tool.id, selection: selectionPayload(expand(tool, [{ kind: "face", id: face }])), params: { dx: o.x, dy: o.y, dz: o.z } };
}
const centrePreviews = new LatestWins<CentreMove>(async ({ face, offset }, current) => {
  const req = centreRequest(face, offset);
  if (!req) return;
  try {
    const mesh = await core.request<MeshData>("tool_preview", req);
    if (!current()) return; // released or cancelled while this was computed
    show(mesh);
    status.classList.remove("error");
    status.textContent = `Move hole: ${showNumber(offset.x)}, ${showNumber(offset.y)}, ${showNumber(offset.z)}`;
  } catch (e) {
    if (!current()) return;
    status.textContent = (e as Error).message;
    status.classList.add("error");
  }
});
viewport.onCentreDrag = async (face, offset, phase) => {
  if (phase === "move") {
    centrePreviews.push({ face, offset: { x: offset.x, y: offset.y, z: offset.z } });
    return;
  }
  await centrePreviews.cancel();
  if (phase === "cancel") {
    if (app.committed) show(app.committed);
    return;
  }
  const req = centreRequest(face, { x: offset.x, y: offset.y, z: offset.z });
  if (!req) return;
  try {
    const mesh = await core.request<MeshData>("tool_commit", req);
    setCommitted(mesh, false, mappedSelection(mesh));
  } catch (e) {
    if (app.committed) setCommitted(app.committed, false, app.currentSels);
    status.textContent = (e as Error).message;
    status.classList.add("error");
  }
};
viewport.onEyedropCancel = () => cancelEyedrop();
// The push/pull direction: the gizmo's pick icon asks for an edge (a straight line) or a face (its normal); the selected face itself goes back to its own normal.
viewport.pullDirection.onChange = () => void refreshSelectionHandles();
viewport.pullGizmo.onPick = () => {
  cancelEyedrop();
  status.classList.remove("error");
  status.textContent = "Push/pull direction: click a straight edge (or a face for its normal); the selected face resets it; Esc cancels";
  // The icon is an HTML button, so its press and release are over (the click event comes after them) and cannot pick anything in the view: arm at once.
  viewport.eyedropper = pickPullDirection;
};
const pickPullDirection = (sel: Sel) => {
  const own = app.currentSels.length === 1 && app.currentSels[0].kind === "face" && sel.kind === "face" && sel.id === app.currentSels[0].id;
  const result = resolvePick(own, own ? null : viewport.directionOf(sel), viewport.pullDirection.normal);
  if (result.kind === "refused") {
    status.textContent = "Pick a straight edge or a flat face for the direction (Esc cancels)";
    status.classList.add("error");
    return; // the picker stays armed
  }
  viewport.eyedropper = null;
  viewport.pullDirection.set(result.kind === "set" ? result.direction : null);
  status.textContent = result.kind === "set" ? "Push/pull direction set; drag the arrow" : "Push/pull direction reset to the face normal";
};
viewport.onFaceBody = (id) => {
  const picked: Sel[] = [{ kind: "body", id }];
  viewport.selectItems(picked);
  setSelection(picked);
  status.textContent = "Whole body selected by double-click on a face (the same as its row in the body list)";
};
viewport.onEdgeLoop = async (edgeId, additive) => {
  try {
    // The chain follows tangent continuity only (a rim, a smooth outline); Ctrl adds it to the selection.
    const { edges } = await core.request<{ edges: number[] }>("edge_chain", { edge: edgeId });
    const picked: Sel[] = edges.map((id) => ({ kind: "edge" as const, id }));
    const sels = additive ? [...app.currentSels.filter((s) => !(s.kind === "edge" && edges.includes(s.id))), ...picked] : picked;
    viewport.selectItems(sels);
    setSelection(sels);
    status.textContent = `${picked.length} edge${picked.length === 1 ? "" : "s"} selected by double-click (edges that continue smoothly from this one; Ctrl+double-click adds them to the selection)`;
  } catch (e) {
    status.textContent = (e as Error).message;
  }
};

itemDrag.installKeys();

viewport.onItemDrag = itemDrag.onItemDrag;

const editLastButton = $("editlast") as HTMLButtonElement;

function rememberOp(tool: ToolInfo | null, sels: Sel[], distance: number) {
  const param = tool && dragParam(tool);
  if (!tool || !param) return;
  app.lastOp = { tool, sels, values: { [param]: distance } };
  editLastButton.disabled = false;
}

editLastButton.addEventListener("click", async () => {
  const op = app.lastOp;
  if (!op) return;
  await history("undo"); // back to the model before the operation (same ids, so the selection still fits)
  viewport.selectItems(op.sels);
  setSelection(op.sels);
  toolPanel.openForm(op.tool, op.values);
});

async function history(kind: "undo" | "redo") {
  if (sketch.active) return sketch.step(kind); // while a sketch is edited the top bar steps through the sketch's own edits
  try {
    setCommitted(await core.request<MeshData>(kind));
  } catch (e) {
    status.textContent = (e as Error).message;
  }
}
undoButton.addEventListener("click", () => history("undo"));
redoButton.addEventListener("click", () => history("redo"));
const { bodyList, setVisibility } = installBodyActions({
  core,
  status,
  list: $("bodylist"),
  count: $("bodycount"),
  committed: () => app.committed,
  selection: () => app.currentSels,
  show: (mesh) => show(mesh),
  setCommitted: (mesh, frame, sels) => setCommitted(mesh, frame, sels),
  select: (sels) => {
    viewport.selectItems(sels);
    setSelection(sels);
  },
  hover: (sel) => viewport.hoverItem(sel),
  editPrimitive: (id) => editPrimitive(id),
});

// Zoom to fit leaves out the strip across the top of the view (the tool buttons): the fit uses the room below it.
viewport.fitInsets = () => {
  const strip = $("tools").getBoundingClientRect();
  const view = $("viewport").getBoundingClientRect();
  return { top: strip.height > 0 ? Math.max(0, strip.bottom - view.top + 8) : 0, right: 0, bottom: 0, left: 0 };
};

// Keyboard shortcuts: one router applies the policy in keys.ts (engagement, blur, repeat, entry, sketch) and runs these.
const keys = new KeyRouter({
  viewport: $("viewport"),
  handlers: {
    ...Object.fromEntries(Object.entries(VIEW_KEYS).map(([, name]) => [`view.${name}`, () => viewport.setView(name)])),
    "view.projection": () => navCube.toggleProjection(),
    "display.seeThrough": () => viewport.toggleSeeThrough(),
    "ui.shortcuts": () => keys.openSettings(),
    "view.lookAtFace": () => {
      if (app.currentSels.length === 1 && app.currentSels[0].kind === "face" && !viewport.alignToFace(app.currentSels[0].id)) status.textContent = "Look at face: could not find a view direction for this face";
    },
    measure: () => {
      const why = viewport.toggleMeasureKey();
      if (why) status.textContent = why;
    },
    "display.drawer": () => toggleDrawer(),
    "display.hide": () => setVisibility("hide"),
    "display.isolate": () => setVisibility("isolate"),
    "display.showAll": () => setVisibility("show"),
    "history.undo": () => void history("undo"),
    "history.redo": () => void history("redo"),
    "sketch.smartDimension": () => sketch.chooseConstraint("Dimension"),
    ...Object.fromEntries(SKETCH_CONSTRAINT_KEYS.map((k) => [k.id, () => sketch.chooseConstraint(k.constraint)])),
    ...Object.fromEntries(["sketch.undo", "sketch.redo", "sketch.cancel", "sketch.finish", "sketch.delete"].map((id) => [id, (e: KeyboardEvent) => sketch.onKey(e)])),
  },
  entryActive: () => viewport.dragging || itemDrag.isDragging() || viewport.manipulator.dragging || viewport.pullGizmo.dragging,
  sketchActive: () => sketch.active,
  cancelInteraction: () => {
    viewport.cancelDrag();
    viewport.manipulator.cancel();
    viewport.pullGizmo.cancel();
  },
  status,
  hints: { get: () => hintLine.prefs.on, set: (on) => hintLine.setOn(on) },
});
syncSeeThrough();
setKeysOpener(() => keys.openSettings());
setHintsBinding({ get: () => hintLine.prefs.on, set: (on) => hintLine.setOn(on) });
// Leaving with edits (undo steps) or an open sketch asks first; autosave still protects against crashes.
window.addEventListener("beforeunload", (e) => {
  if (app.modelHistory.undo || sketch.active) e.preventDefault();
});

installFileOpening(
  { core, status, hasEdits: () => app.modelHistory.undo || sketch.active, setCommitted: (mesh, frame) => setCommitted(mesh as MeshData, frame),
    endTool: () => {
      if (toolPanel.isOpen) toolPanel.close(false); // an open tool form would be applied to the new model by the selection reset
      armedTool = null;
      waitingTool.cancel();
      viewport.cancelDrag();
      viewport.manipulator.cancel();
      viewport.pullGizmo.cancel();
    } },
  { open: $("open"), openAsNew: $("openasnew"), openProject: $("openproject"), newProject: $("newproject") },
  { step: fileInput, project: $("projectfile") as HTMLInputElement },
);

/** Ask the core for the model in a file format and save it through the browser. */
const exportAs = (request: string, extension: string, params: Record<string, unknown> = {}) => saveModel(core, status, loadedSample || "model", request, extension, params);

$("export").addEventListener("click", () => exportAs("export_step", "step"));
$("saveproject").addEventListener("click", () => exportAs("save_project", "plbl"));
const exportCad = $("exportcad") as HTMLSelectElement;
exportCad.addEventListener("change", () => {
  const format = exportCad.value;
  exportCad.value = "";
  if (format) void exportAs("export_cad", format === "stpz" ? "stpZ" : format, { format });
});
const exportMesh = $("exportmesh") as HTMLSelectElement;
/** Ask for the tessellation, then export the mesh. */
async function exportMeshAs(format: string) {
  const options = await askMeshOptions(format);
  if (options) void exportAs("export_mesh", format, { format, ...options });
}
exportMesh.addEventListener("change", () => {
  const format = exportMesh.value;
  exportMesh.value = "";
  if (format) void exportMeshAs(format);
});

select.addEventListener("change", () => {
  const name = select.value;
  select.value = ""; // back to the prompt, so any sample (the first too) can be chosen again
  if (!name) return;
  if (app.modelHistory.undo && !window.confirm("Opening a sample model replaces the current model and its undo history. Continue?")) return;
  loadedSample = name;
  load(name).catch((e) => (status.textContent = e.message));
});

function commands(): Command[] {
  const usable = new Set(usableTools().map((t) => t.id));
  const toolCommands: Command[] = tools.map((tool) => ({
    label: tool.label,
    scope: "tool" as const,
    keywords: toolKeywords(tool.id),
    title: toolTooltip(tool),
    hint: usable.has(tool.id) ? "drag the selection" : `select ${describeNeeds(tool)}`,
    enabled: true, // never hidden or blocked: a tool whose selection does not fit waits for one
    nofit: !usable.has(tool.id),
    run: () => {
      if (fitsSelection(tool)) return armTool(tool, "search");
      void settleOpenArray().then(() => { if (waitForSelection(tool)) toolPanel.close(); }); // same wait as the drawer: the open form is dropped
    },
  }));
  const demos: Command[] = [...select.options].filter((option) => option.value).map((option) => ({
    label: `Open sample model: ${option.value}`,
    scope: "file" as const,
    enabled: true,
    run: () => {
      select.value = option.value;
      select.dispatchEvent(new Event("change")); // same confirm as the menu
    },
  }));
  const settingCommands: Command[] = SETTING_ENTRIES.map((entry) => ({
    label: `Setting: ${entry.label}`,
    scope: "setting" as const,
    keywords: entry.keywords,
    hint: settingValue(entry.id),
    title: "Open the settings window at this row",
    enabled: true,
    run: () => openSettings(entry.id),
  }));
  return [
    ...toolCommands,
    ...settingCommands,
    { label: "Undo", scope: "view", hint: keys.keymap.hint("history.undo"), enabled: !undoButton.disabled, run: () => history("undo") },
    { label: "Redo", scope: "view", hint: keys.keymap.hint("history.redo"), enabled: !redoButton.disabled, run: () => history("redo") },
    { label: "Hide body", scope: "body", hint: keys.keymap.hint("display.hide"), enabled: app.currentSels.length > 0, run: () => setVisibility("hide") },
    { label: "Isolate body", scope: "body", hint: keys.keymap.hint("display.isolate"), enabled: app.currentSels.length > 0, run: () => setVisibility("isolate") },
    { label: "Show all bodies", scope: "body", hint: keys.keymap.hint("display.showAll"), enabled: bodyView.hidden.size > 0, run: () => setVisibility("show") },
    { label: "See-through selection (pick edges and faces behind the model)", scope: "view", keywords: ["x ray", "transparent", "xray"], hint: keys.keymap.hint("display.seeThrough"), enabled: true, run: () => viewport.toggleSeeThrough() },
    {
      label: `Measure pick (hidden mode: press ${keys.keymap.hint("measure") || "its key"} while dragging a tool)`,
      scope: "view" as const,
      keywords: ["distance", "dimension", "ruler"],
      hint: `${keys.keymap.hint("measure")} while dragging`,
      title: "Start dragging a tool, then press the measure key to measure distances to other geometry. It cannot start from this list.",
      enabled: true,
      run: () => (status.textContent = "Measure pick: start dragging a tool, then press M to pick geometry to measure against"),
    },
    { label: "Keyboard shortcuts (see and change them; hotkeys)", scope: "view", keywords: ["keys", "bindings", "rebind"], hint: keys.keymap.hint("ui.shortcuts"), enabled: true, run: () => keys.openSettings() },
    { label: hintLine.prefs.on ? "Turn hints off" : "Turn hints on", scope: "view", keywords: ["tips", "help line"], enabled: true, run: () => hintLine.setOn(!hintLine.prefs.on) },
    { label: "Getting started (the first things to try)", scope: "view", keywords: ["help", "tutorial", "learn", "tips", "intro", "basics"], enabled: true, run: () => hintLine.showGettingStarted() },
    { label: "Import STEP file (add to model)", scope: "file", keywords: ["iges", "igs", "brep", "stpz", "stp", "3dm", "ifc", "cad"], enabled: true, run: () => $("open").click() },
    { label: "New project (empty)", scope: "file", keywords: ["blank", "clear"], enabled: true, run: () => $("newproject").click() },
    { label: "Open STEP file as new project", scope: "file", keywords: ["iges", "igs", "brep", "stpz", "stp", "3dm", "ifc", "cad"], enabled: true, run: () => $("openasnew").click() },
    ...(["XY", "XZ", "YZ"] as const).map((plane) => ({ label: `Add datum plane: ${plane} origin plane`, scope: "file" as const, keywords: ["helper plane", "construction", "mirror"], enabled: true, run: () => addDatum({ plane }) })),
    ...(["XY", "XZ", "YZ"] as const).map((plane) => ({ label: `Mirror mode on: ${plane} origin plane`, scope: "file" as const, keywords: ["symmetry", "symmetric", "mirror"], enabled: true, run: () => keptRequest("mirror_set", { plane }) })),
    { label: "Mirror mode on: the selected face", scope: "file", keywords: ["symmetry", "symmetric", "mirror"], enabled: app.currentSels.length === 1 && app.currentSels[0].kind === "face", run: () => keptRequest("mirror_set", { face: app.currentSels[0].id, name: "Selected face" }) },
    ...datumPlanes.planes.map((d) => ({ label: `Mirror mode on: datum plane ${d.name}`, scope: "file" as const, keywords: ["symmetry", "symmetric", "mirror"], enabled: true, run: () => keptRequest("mirror_set", { datum_id: d.id }) })),
    { label: "Mirror mode off", scope: "file", keywords: ["symmetry", "symmetric", "mirror"], enabled: true, run: () => keptRequest("mirror_clear", {}) },
    { label: "Add datum plane on the selected face", scope: "file", keywords: ["helper plane", "construction", "mirror"], enabled: app.currentSels.length === 1 && app.currentSels[0].kind === "face", run: () => addDatum({ face: app.currentSels[0].id }) },
    { label: "Add datum plane midway between two selected faces", scope: "file", keywords: ["helper plane", "construction", "mirror", "middle"], enabled: app.currentSels.length === 2 && app.currentSels.every((s) => s.kind === "face"), run: () => addDatum({ midplane: app.currentSels.map((s) => s.id) }) },
    { label: "Export STEP file", scope: "file", enabled: true, run: () => exportAs("export_step", "step") },
    { label: "Save project (.plbl file with bodies, names and sketches)", scope: "file", keywords: ["save", "pliable file"], enabled: true, run: () => exportAs("save_project", "plbl") },
    { label: "Open project (.plbl file)", scope: "file", keywords: ["load", "pliable file"], enabled: true, run: () => $("openproject").click() },
    ...["stl", "obj", "3mf"].map((format) => ({
      label: `Export ${format.toUpperCase()} mesh (lossy)`,
      scope: "file" as const,
      keywords: ["save", "download", "print"],
      enabled: true,
      run: () => void exportMeshAs(format),
    })),
    ...demos,
  ];
}

// Sketch mode: entered from the bar at the bottom (on the selected flat face, or on a world plane).
const sketch = new SketchMode(
  viewport,
  core,
  dimensionOverlay,
  {
    status(text, error = false) {
      status.textContent = text;
      status.classList.toggle("error", error === true);
      status.classList.toggle("warn", error === "warn");
      warnedText = error === "warn" ? text : null;
    },
    pickPoint: () => pointPicker.pick(),
    showBase: (point) => pointPicker.showBase(point),
    restore() {
      if (app.committed) show(app.committed);
      renderSketchBar();
    },
    committed: (mesh) => setCommitted(mesh, false, []),
  },
  $("sketchpanel"),
);
currentSketchTool = () => sketch.activeTool;
chooseSketchTool = (tool) => sketch.selectTool(tool);
sketchConstraints = () => sketch.constraintChoices();
chooseConstraint = (label) => sketch.chooseConstraint(label);
sketch.onToolChange = () => {
  selected.textContent = sketch.active ? sketch.selectionText() : describe(app.currentSels); // the readout bottom right names what is selected
  renderToolbar();
  syncHistoryButtons();
  navCube.fitSelectedButton.disabled = sketch.active ? !sketch.selection.length : app.currentSels.length === 0; // in a sketch the fit button follows the sketch selection
};
/** Run a request that changes the kept sketches and takes the document state it answers with. */
function keptRequest(kind: string, args: Record<string, unknown>) {
  core
    .request<MeshData>(kind, args)
    .then((mesh) => setCommitted(mesh, false, app.currentSels))
    .catch((e) => {
      status.textContent = (e as Error).message;
      status.classList.add("error");
    });
}
const keptSketches = new KeptSketches({
  core,
  scene: viewport.scene,
  list: $("keptsketches"),
  count: $("keptsketchcount"),
  async open(id) {
    if (sketch.active) {
      status.textContent = "Finish or discard the open sketch first";
      return;
    }
    try {
      const reply = await core.request<{ sketch_id: number; name: string; sketch: any }>("sketch_get", { sketch_id: id });
      sketch.start(reply.sketch.plane, undefined, null, undefined, { id: reply.sketch_id, name: reply.name, sketch: reply.sketch });
    } catch (e) {
      status.textContent = (e as Error).message;
      status.classList.add("error");
    }
  },
  remove: (id) => keptRequest("sketch_delete", { sketch_id: id }),
  pick: (id) => pickRow({ list: "sketch", id }),
  rename: (id, name) => keptRequest("sketch_rename", { sketch_id: id, name }),
});
onSketches = (list) => keptSketches.setList(list);
const datumPlanes = new DatumPlanes({
  scene: viewport.scene,
  list: $("datumlist"),
  count: $("datumcount"),
  mirror: $("mirrorstate"),
  mirrorOff: () => keptRequest("mirror_clear", {}),
  remove: (id) => keptRequest("datum_delete", { datum_id: id }),
  pick: (id) => pickRow({ list: "datum", id }),
  rename: (id, name) => keptRequest("datum_rename", { datum_id: id, name }),
});
// The Delete key (listdelete.ts): selected bodies, or the sketch or datum plane row last clicked.
function pickRow(row: RowRef | null) {
  app.pickedRow = row;
  keptSketches.setPicked(row?.list === "sketch" ? row.id : null);
  datumPlanes.setPicked(row?.list === "datum" ? row.id : null);
  if (row && app.currentSels.length) {
    viewport.selectItems([]);
    setSelection([]);
  }
}
window.addEventListener("keydown", (e) => {
  const action = deleteAction(e.key, {
    bodies: app.currentSels.filter((s) => s.kind === "body").map((s) => s.id),
    row: app.pickedRow,
    typing: isTyping(e.target),
    blocked: sketch.active || toolPanel.isOpen || e.ctrlKey || e.metaKey || e.altKey || viewport.dragging || itemDrag.isDragging(),
  });
  if (!action) return;
  e.preventDefault();
  if (action.kind === "bodies") {
    if (action.ids.length === 1) void core.request<MeshData>("delete_body", { body: action.ids[0] }).then((mesh) => setCommitted(mesh, false, [])).catch(showError);
    else void core.request<MeshData>("delete_body", { bodies: action.ids }).then((mesh) => setCommitted(mesh, false, [])).catch(showError);
  } else {
    const id = action.row.id;
    pickRow(null);
    void (action.row.list === "sketch" ? keptRequest("sketch_delete", { sketch_id: id }) : keptRequest("datum_delete", { datum_id: id }));
  }
});
function showError(e: unknown) {
  status.textContent = (e as Error).message;
  status.classList.add("error");
}
onDatums = (list, mirror) => {
  datumPlanes.setList(list);
  datumPlanes.setMirror(mirror);
};
$("datumhead").addEventListener("click", () => {
  const head = $("datumhead");
  head.setAttribute("aria-expanded", String(head.getAttribute("aria-expanded") !== "true"));
});
/** Add a datum plane from a request the core understands as a sketch plane (or a midplane of two faces). */
function addDatum(args: Record<string, unknown>) {
  keptRequest("datum_add", args);
}
viewport.profileTargets = () => (sketch.active ? [] : keptSketches.fillTargets());
viewport.onProfileClick = (id, region, additive) => void pickProfile(id, region, additive);
viewport.curveTargets = () => keptSketches.curveTargets();
// Shift or Ctrl+click on a kept sketch's curve chooses the whole sketch beside the selection (click it again to let it go); the curves turn orange.
viewport.onSketchCurveClick = (id) => {
  if (toolPanel.isOpen) return;
  setChosenSketch(app.chosenSketch === id ? null : id);
  const name = keptSketches.infos.find((k) => k.id === id)?.name ?? `Sketch ${id}`;
  status.classList.remove("error");
  status.textContent = app.chosenSketch === null ? `${name} no longer chosen` : `${name} chosen (Shift+click its curve again to let it go)`;
  app.keepingChosen = true; // the tools that can follow it (Sweep face, Array along path) now fit the selection
  try {
    setSelection(app.currentSels);
  } finally {
    app.keepingChosen = false;
  }
};
reference.keptSnaps = () => keptSketches.snapData(); // point picks snap to the ends, centers, midpoints and curves of kept sketches
viewport.onProfileHover = (at, curve) => {
  keptSketches.setHoveredRegion(at);
  keptSketches.setHovered(curve ?? at?.id ?? null);
};
// Double-clicking a sketch in the view selects the whole sketch (the same pick as its row in the list, so Delete removes it).
viewport.onSketchDouble = (id) => void (profilePicking ?? Promise.resolve()).then(() => pickRow({ list: "sketch", id }));
sketch.onEditing = (id) => keptSketches.setEditing(id);
$("keptsketchhead").addEventListener("click", () => {
  const head = $("keptsketchhead");
  head.setAttribute("aria-expanded", String(head.getAttribute("aria-expanded") !== "true"));
});
const sketchBar = new SketchBar({
  core,
  sketch,
  bar: $("sketchbar"),
  selection: () => app.currentSels,
  viewPlane: () => viewport.viewPlane(),
  status(text, error = false) {
    status.textContent = text;
    status.classList.toggle("error", error);
  },
  diagnostics: () => showDiagnostics(core),
});
const hintLine = new HintLine(
  $("viewport"),
  () => ({ dragging: viewport.dragging || itemDrag.isDragging(), sketch: sketch.active, hasSelection: app.currentSels.length > 0 }),
  (id) => keys.keymap.hint(id),
);
function renderSketchBar() {
  sketchBar.update();
}
renderSketchBar();

// Tools without a drag parameter (and the "All tools" list) use a typed-value form with live preview.
let eyedropResolve: ((v: number | null) => void) | null = null;
function cancelEyedrop() {
  viewport.eyedropper = null;
  eyedropResolve?.(null);
  eyedropResolve = null;
}

/** The number a measured item holds for a tool parameter: radius, diameter, angle, else a length. */
function readValue(rows: { label: string; value: number | number[] | string }[], param: string, kind: string): number | null {
  const num = (label: string) => {
    const v = rows.find((r) => r.label === label)?.value;
    return typeof v === "number" ? v : null;
  };
  const radius = num("Radius") ?? (num("Diameter") !== null ? num("Diameter")! / 2 : null);
  const diameter = num("Diameter") ?? (radius !== null ? radius * 2 : null);
  if (kind === "angle") return num("Angle");
  if (/diam/i.test(param)) return diameter;
  if (/radius/i.test(param)) return radius;
  return num("Length") ?? num("Distance") ?? radius;
}

/** While the Divide face form is open, the viewport lets a drag over the model place the dividing line. */
async function updateDivideFrame() {
  const face = toolPanel.openToolId === "divide_face" && app.currentSels.length === 1 && app.currentSels[0].kind === "face" ? app.currentSels[0].id : null;
  if (face === null) {
    viewport.divideFrame = null;
    return;
  }
  try {
    const f = await core.request<{ centre: number[]; normal: number[]; u: number[]; v: number[] }>("face_frame", { face });
    if (toolPanel.openToolId !== "divide_face") return;
    const vec = (a: number[]) => new THREE.Vector3(a[0], a[1], a[2]);
    viewport.divideFrame = { face, centre: vec(f.centre), normal: vec(f.normal), u: vec(f.u), v: vec(f.v) };
    if (!status.classList.contains("error")) status.textContent = "Divide face: drag across the face to place the dividing edge, or type the offset";
  } catch {
    viewport.divideFrame = null;
  }
}
viewport.onDivideDrag = (across, offset) => toolPanel.setValues({ across, offset, angle: 0, columns: 0, rows: 0 }); // a drag places one line along an axis

let formPreviewSeq = 0;
let previewBusy = false;
let previewWaiting: { tool: ToolInfo; values: Record<string, ParamValue>; editBody?: number } | null = null;
async function drainPreviews() {
  previewBusy = true;
  try {
    while (previewWaiting) {
      const next = previewWaiting;
      previewWaiting = null;
      if (!toolPanel.isOpen) break; // the form closed while this waited
      await runPreview(next.tool, next.values, next.editBody);
    }
  } finally {
    previewBusy = false;
  }
}

/** A drag of a move arrow in an open form: the arrow's value now, and what the last shown preview was for. */
let slideLive: { info: HandleInfo; value: number } | null = null;
let slideTrack: { centres: Map<number, [number, number, number]>; value: number; moving: Set<number> | null } | null = null;

/** Show the shift the pointer has made since the shown preview was asked for, on the bodies that move (client side, at once). */
function slideNow() {
  if (!slideLive || !slideTrack?.moving) return;
  const { info, value } = slideLive;
  const d = (value - slideTrack.value) / (info.scale || 1);
  (window as any).__slid = ((window as any).__slid ?? 0) + 1;
  viewport.slideBodies(slideTrack.moving, [info.direction[0] * d, info.direction[1] * d, info.direction[2] * d]);
}

async function runPreview(tool: ToolInfo, values: Record<string, ParamValue>, editBody?: number) {
  if (sketchMove !== null) return runSketchMovePreview(values);
  const seq = ++formPreviewSeq;
  const t0 = performance.now();
  const sentValue = slideLive?.value;
  try {
    const mesh = await core.request<MeshData>("tool_preview", { tool: tool.id, selection: selectionPayload(editBody === undefined ? expand(tool, app.currentSels) : []), params: values, ...(editBody === undefined ? {} : { edit_body: editBody }) });
    const t1 = performance.now();
    if (!toolPanel.isOpen || seq !== formPreviewSeq) return; // closed or a newer preview was asked for
    show(mesh);
    toolPanel.setSideColours(mesh.header.sides);
    if (slideLive && sentValue !== undefined) {
      // Which bodies a move arrow moves is read off two previews of the same drag (their centers shift along the arrow).
      const centres = bodyCentres(mesh.vertices);
      const before = slideTrack;
      const moving = before && before.value !== sentValue ? movedBodies(before.centres, centres, slideLive.info.direction, 1e-4, (sentValue - before.value) / (slideLive.info.scale || 1)) : before?.moving ?? null;
      slideTrack = { centres, value: sentValue, moving };
      slideNow();
    }
    ((window as any).__perf ??= []).push({ sinceEvent: t0 - lastDragEvent, roundTrip: t1 - t0, show: performance.now() - t1, timings: mesh.header.timings, tris: mesh.indices.length / 3 });
    viewport.manipulator.setHandles(moveHandlesAt(mesh.header.handles ?? [], toolPanel.basePosition()));
    status.classList.remove("error");
    status.textContent = `${tool.label}: preview`;
  } catch (e) {
    if (seq !== formPreviewSeq) return;
    status.textContent = (e as Error).message;
    status.classList.add("error");
  }
}

function twoDistances(distance: number) {
  void switchToTwoDistances(
    {
      core,
      tools: () => tools,
      selection: () => app.currentSels,
      open(tool, sels, values) {
        toolPanel.close();
        armedTool = null;
        viewport.selectItems(sels);
        setSelection(sels);
        renderToolbar();
        toolPanel.openForm(tool, values, "other");
      },
      say(text, error) {
        status.textContent = text;
        status.classList.toggle("error", error);
      },
    },
    distance,
  );
}

// The Hole Editor: opens on a selected hole in the tool form's place (see holeeditorcard.ts); it needs the tool form below, which calls back into it.
const holeEditor = createHoleEditor({
  toolPanel: () => toolPanel,
  tools: () => tools,
  classify: (sels) => core.request<{ kind: string; count?: number; pick?: "wall" | "cylinder" | "other" }>("hole_selection", { selection: selectionPayload(sels) }),
  selection: () => app.currentSels,
  busy: () => armedTool !== null || !!viewport.interceptor,
});
const toolPanel = new ToolPanel($("toollist"), $("toolform"), {
  selectedEdges: () => app.currentSels.filter((s) => s.kind === "edge").map((s) => s.id),
  pickPoint: (options) => pointPicker.pick(options),
  showBase: (point) => pointPicker.showBase(point),
  async anchors(tool, values) {
    try {
      return (await core.request<{ anchors: AnchorInfo[] }>("tool_handles", { tool: tool.id, selection: selectionPayload([]), params: values })).anchors;
    } catch {
      return [];
    }
  },
  tools: () => tools,
  cardHeader: (tool) => holeEditor.header(tool),
  waitFor: (tool) => waitForSelection(tool),
  usable: (tool) => (acceptsSelection(tool, expand(tool, app.currentSels)) || acceptsWithRail(tool, expand(tool, app.currentSels), app.chosenSketch) || (tool.id === "move_body" && movableSketch() !== null)) && (app.refined === null || app.refined.includes(tool.id)),
  preview(tool, values, editBody) {
    // One preview in flight at a time, the newest request waiting behind it (latest wins): the core answers in order, so
    // sending every pointer move would show nothing until the pointer rests while the replies queue up.
    previewWaiting = { tool, values, editBody };
    if (!previewBusy) void drainPreviews();
    return Promise.resolve();
  },
  async commit(tool, values, editBody) {
    if (sketchMove !== null) {
      const id = sketchMove;
      sketchMove = null;
      try {
        setCommitted(await core.request<MeshData>("sketch_move", { sketch_id: id, params: values, commit: true }), false);
        usage.record(tool.id, "commit");
      } catch (e) {
        usage.record(tool.id, "error");
        keptSketches.previewPlane(id, null);
        status.textContent = (e as Error).message;
        status.classList.add("error");
      }
      return;
    }
    const sels = app.currentSels;
    try {
      const mesh = await core.request<MeshData>("tool_commit", { tool: tool.id, selection: selectionPayload(editBody === undefined ? expand(tool, sels) : []), params: values, ...(editBody === undefined ? {} : { edit_body: editBody }) });
      setCommitted(mesh, false, mappedSelection(mesh));
      app.lastOp = { tool, sels, values };
      editLastButton.disabled = false;
      usage.record(tool.id, "commit");
    } catch (e) {
      usage.record(tool.id, "error");
      if (app.committed) setCommitted(app.committed, false, sels);
      status.textContent = (e as Error).message;
      status.classList.add("error");
    }
  },
  eyedrop(param, kind) {
    return new Promise((resolve) => {
      cancelEyedrop();
      if (app.committed) show(app.committed); // pick against the committed model, whose ids the core knows
      status.classList.remove("error");
      status.textContent = "Eyedropper: click the item to copy from (Esc cancels)";
      eyedropResolve = resolve;
      viewport.eyedropper = async (sel) => {
        viewport.eyedropper = null;
        eyedropResolve = null;
        try {
          const reply = await core.request<MeasureReply>("measure", { selection: selectionPayload([sel]) });
          const value = readValue(reply.items[0]?.rows ?? [], param, kind);
          status.textContent = value === null ? "That item has no matching value" : `Copied ${value}`;
          resolve(value);
        } catch (e) {
          status.textContent = (e as Error).message;
          resolve(null);
        }
      };
    });
  },
  pickEdgePoint() {
    return new Promise((resolve) => {
      cancelEyedrop();
      if (app.committed) show(app.committed); // pick against the committed model, whose edges the core knows
      status.classList.remove("error");
      status.textContent = "Pick the edge the face pivots about (any edge or corner of the model; Esc cancels)";
      eyedropResolve = () => resolve(null);
      viewport.eyedropper = (sel) => {
        const data = app.committed;
        // A click near an end of an edge picks its corner point instead of the edge; that point is as good a pivot, so it counts too.
        const corner = sel.kind === "vertex" && data ? data.vertices.find((v) => v.id === sel.id)?.position ?? null : null;
        const point = sel.kind === "edge" && data ? edgeMiddle(data.edges, data.edgePositions, sel.id) : sel.kind === "axis" ? [0, 0, 0] : corner ? [...corner] : null; // a global axis passes through the origin
        if (!point) {
          status.textContent = "Pick an edge or a corner point (Esc cancels)";
          status.classList.add("error");
          return; // stays armed
        }
        viewport.eyedropper = null;
        eyedropResolve = null;
        status.textContent = "Pivot edge picked";
        resolve(point);
      };
    });
  },
  pickEdgeId() {
    return new Promise((resolve) => {
      cancelEyedrop();
      if (app.committed) show(app.committed); // pick against the committed model, whose edge ids the core knows
      status.classList.remove("error");
      status.textContent = "Pick the axis: a straight or circular edge, or a global axis (Esc cancels)";
      eyedropResolve = () => resolve(null);
      viewport.eyedropper = (sel) => {
        if (sel.kind !== "edge" && sel.kind !== "axis") {
          status.textContent = "Pick an edge or a global axis (Esc cancels)";
          status.classList.add("error");
          return; // stays armed
        }
        viewport.eyedropper = null;
        eyedropResolve = null;
        status.textContent = "Axis picked";
        resolve(sel.kind === "axis" ? -2 - sel.id : sel.id); // a global axis X, Y, Z is -2, -3, -4
      };
    });
  },
  pickPlane() {
    return new Promise((resolve) => {
      cancelEyedrop();
      if (app.committed) show(app.committed); // pick against the committed model, whose face ids the core knows
      status.classList.remove("error");
      status.textContent = "Pick a flat face for the plane (Esc cancels)";
      eyedropResolve = () => resolve(null);
      viewport.eyedropper = async (sel) => {
        if (sel.kind !== "face") {
          status.textContent = "Pick a flat face (Esc cancels)";
          status.classList.add("error");
          return; // stays armed
        }
        viewport.eyedropper = null;
        eyedropResolve = null;
        try {
          const f = await core.request<{ centre: number[]; normal: number[] }>("face_frame", { face: sel.id });
          status.textContent = "Plane picked";
          resolve({ origin: f.centre, normal: f.normal });
        } catch (e) {
          status.textContent = (e as Error).message; // not a flat face
          status.classList.add("error");
          resolve(null);
        }
      };
    });
  },
  pickItem(kind, message) {
    return new Promise((resolve) => {
      cancelEyedrop();
      if (app.committed) show(app.committed); // pick against the committed model, whose ids the core knows
      status.classList.remove("error");
      status.textContent = `${message} (Esc cancels)`;
      eyedropResolve = () => resolve(null);
      viewport.eyedropper = (sel) => {
        if (sel.kind !== kind) {
          status.textContent = `Pick a${kind === "edge" ? "n" : ""} ${kind} (Esc cancels)`;
          status.classList.add("error");
          return; // stays armed
        }
        viewport.eyedropper = null;
        eyedropResolve = null;
        status.textContent = "Picked";
        resolve(sel.id);
      };
    });
  },
  async planeFrom(request) {
    try {
      const plane = (await core.request<{ plane: PlaneData }>("sketch_plane", request)).plane;
      status.classList.remove("error");
      status.textContent = "Plane made";
      return { origin: plane.origin, normal: plane.normal };
    } catch (e) {
      status.textContent = (e as Error).message;
      status.classList.add("error");
      return null;
    }
  },
  datumPlanes: () => datumPlanes.planes,
  twoDistances,
  sketchList: () => keptSketches.infos,
  async sketchPlane(id) {
    try {
      return (await core.request<{ sketch: { plane: PlaneData } }>("sketch_get", { sketch_id: id })).sketch.plane;
    } catch {
      return null;
    }
  },
  cancelEyedrop,
  changed: () => {
    if (toolPanel.isOpen) pushPullCard.close(); // another tool's form takes the card's place
    if (!toolPanel.isOpen) {
      viewport.manipulator.clear();
      void refreshSelectionHandles(); // back to the selection's own handles
    }
    renderChips();
    updateDivideFrame();
  },
  async settleOpenForm() {
    await settleOpenArray();
  },
  cancel() {
    if (sketchMove !== null) {
      keptSketches.previewPlane(sketchMove, null);
      sketchMove = null;
    }
    if (app.committed) {
      show(app.committed);
      status.classList.remove("error");
    }
  },
});
toolPanel.renderList();
sectionPanel = new SectionPanel($("sectioncard"), section, toolPanel.host);
const sectionPanelChanged = section.onChange;
section.onChange = () => {
  sectionPanelChanged();
  syncSection();
};
syncSection();
// A handle dragged in the view sets its parameter through the open form, so typed entry and the preview stay in step.
// With no form open (a selection waiting for its drag tool) the handle runs that tool's normal drag instead.
let lastDragEvent = 0;
// The value arrow of the selection's drag tool (push/pull's) starts the same drag as pressing the face: measure pick, typed value, Shift.
viewport.handleStartsItemDrag = (info) =>
  !toolPanel.isOpen && selectionHandleTool?.id === "push_pull" && !info.toggle && info.param === dragParam(selectionHandleTool);
viewport.manipulator.onDrag = (param, value, phase, x, y, linked) => {
  lastDragEvent = performance.now();
  if (sketch.onPlaneDrag(param, value, phase)) return; // a sketch's plane gizmo
  if (section.onDrag(param, value, phase)) return; // the section plane's slide arrow
  const info = viewport.manipulator.dragInfo;
  if (toolPanel.isOpen && phase === "move" && info?.kind === "move") {
    slideLive = { info, value };
    slideNow();
  } else if (phase !== "move") {
    slideLive = null;
    slideTrack = null;
  }
  if (toolPanel.isOpen) toolPanel.setValues({ ...linked, [param]: value });
  else if (selectionHandleTool && dragParam(selectionHandleTool) === null) {
    // A tool without a drag value (a hole's size, depth and position): its handle opens the form, which then carries the preview.
    toolPanel.openForm(selectionHandleTool, {}, "drag");
    toolPanel.setValues({ ...linked, [param]: value });
  } else void viewport.onItemDrag(app.currentSels, phase === "cancel" ? 0 : value, phase, x, y);
};

new Palette(commands);
$("gettingstartedbtn").addEventListener("click", () => hintLine.showGettingStarted());
window.setTimeout(() => hintLine.autoShowGettingStarted(), 1500);
renderToolbar();

// Connect to the core, retrying with a growing delay while it is not running, and again whenever the connection drops.
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 8000;
const reconnectButton = document.getElementById("reconnect") as HTMLButtonElement;
let connecting = false;
let retryTimer: number | undefined;
let wakeRetry: (() => void) | null = null;
reconnectButton.onclick = () => {
  if (wakeRetry) wakeRetry();
  else void connectToCore();
};

function waitRetry(ms: number): Promise<void> {
  return new Promise((resolve) => {
    wakeRetry = () => {
      window.clearTimeout(retryTimer);
      wakeRetry = null;
      resolve();
    };
    retryTimer = window.setTimeout(wakeRetry, ms);
  });
}

/** Everything the page needs from the core after (re)connecting: tools, then the model (kept across a reconnect when the core still holds it). */
async function syncWithCore(hadModel: boolean) {
  void showLaunchNotice(core);
  tools = (await core.request<{ tools: ToolInfo[] }>("list_tools")).tools.filter((t) => !t.hidden);
  renderToolbar();
  toolPanel.renderList();
  const { restore, resume } = await core.request<{ restore?: { name: string; steps: number; saved?: number }; resume?: { name: string } }>("hello");
  if (hadModel || resume) {
    try {
      setCommitted(await core.request<MeshData>("resume_session"), true);
      return;
    } catch {
      // The core no longer has it (it was restarted): fall through to the normal start-up.
    }
  }
  const wanted = restore ? await askRestore(restore) : false;
  if (!core.isOpen()) throw new Error("Lost connection to the core");
  if (restore && wanted) {
    setCommitted(await core.request<MeshData>("restore_session"), true);
    status.textContent = `Restored ${restore.name} (${restore.steps} undo steps)`;
    return;
  }
  await load(loadedSample);
}

async function connectToCore() {
  if (connecting) return;
  connecting = true;
  const hadModel = app.committed !== null;
  let delay = RETRY_MIN_MS;
  try {
    for (;;) {
      try {
        await core.connect();
        reconnectButton.hidden = true;
        status.classList.remove("error");
        await syncWithCore(hadModel);
        if (!core.isOpen()) throw new Error("Lost connection to the core"); // dropped while syncing: the early drop notice was ignored, so keep retrying here
        return;
      } catch {
        // Not reachable, or the connection dropped again while syncing: show it and try again.
        status.classList.add("error");
        reconnectButton.hidden = false;
        const seconds = Math.round(delay / 1000);
        status.textContent = import.meta.env.DEV
          ? `Core not reachable: is 'uv run pliable-server' running in core/? Retrying in ${seconds} s...`
          : `Pliable core not reachable. Retrying in ${seconds} s (or close this tab and start Pliable again)...`;
        await waitRetry(delay);
        delay = Math.min(delay * 2, RETRY_MAX_MS);
      }
    }
  } finally {
    connecting = false;
  }
}


core.onDisconnect = () => {
  dismissRestorePrompt();
  status.classList.add("error");
  status.textContent = "Lost connection to the core (reconnecting...)";
  reconnectButton.hidden = false;
  void connectToCore();
};
void connectToCore();

$("bodyhead").addEventListener("click", () => {
  const head = $("bodyhead");
  head.setAttribute("aria-expanded", String(head.getAttribute("aria-expanded") !== "true"));
});

// Escape clears a body selection (when nothing else is using the key).
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented || !app.currentSels.some((s) => s.kind === "body")) return;
  if (toolPanel.isOpen || viewport.dragging || (e.target as HTMLElement).closest?.("input, textarea")) return;
  viewport.selectItems([]);
  setSelection([]);
});
