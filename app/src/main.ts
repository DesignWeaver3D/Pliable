import * as THREE from "three";
import { moveHandlesAt } from "./placepick";
import { bodyCentres, movedBodies } from "./slide";
import { PointPicker, ReferenceView } from "./reference";
import { installAlphaUi, showDiagnostics, showImportNotice, showLaunchNotice, showMessage } from "./alpha";
import { installMessageLog } from "./messagelog";
import { CoreClient, type MeshData } from "./client";
import { SketchMode } from "./sketch";
import type { Tool as SketchTool } from "./sketch";
import { SketchBar } from "./sketchbar";
import { ToolPanel, type ParamValue } from "./toolpanel";
import { NavCube, VIEW_KEYS } from "./navcube";
import { DimensionOverlay, type Dimension } from "./dimensions";
import { DimensionEditor, withoutDraftTag } from "./dimedit";
import { KeptSketches } from "./keptsketches";
import { deleteAction, isTyping, type RowRef } from "./listdelete";
import { resolvePick } from "./pulldir";
import { DatumPlanes } from "./datumplanes";
import type { DatumPlane, MirrorMode } from "./datumcorners";
import { LatestWins } from "./latestwins";
import { LENGTH_UNIT } from "./units";
import { SETTING_ENTRIES, createSettingsWindow, onSettingsChange, openSettings, setHintsBinding, setKeysOpener, settingValue, settings } from "./settings";
import { MeasurePanel, type MeasureReply } from "./measure";
import { KeyRouter } from "./keyrouter";
import { HintLine } from "./hints";
import { exportAs as saveModel, installFileOpening } from "./filesave";
import { askApplyOrDiscard, isArrayTool } from "./arrayprompt";
import { askRestore, dismissRestorePrompt } from "./restoreprompt";
import { bodyView } from "./appstate";
import { createToolStrip } from "./toolstrip";
import { helperSignature as helperSignatureOf, selectionHelpers as selectionHelpersOf, type HelperDeps } from "./toolhelpers";
import { expand, relatedState, renderChips as chipsRender, type RelatedRule } from "./relatedrules";
import { installBodyActions } from "./bodyactions";
import { Palette, type Command } from "./palette";
import { toolKeywords } from "./search";
import { TOOLS_HANDLE_ICON, uiIcon } from "./icons";
import type { AnchorInfo } from "./placepick";
import { acceptsSelection, describeNeeds, dragParam, toolTooltip, type HandleInfo, type ToolInfo } from "./tools";
import { Viewport, type Sel } from "./viewport";
import { usage, type Surface } from "./usage";
import { pruneGhost, pruneHidden } from "./bodylogic";
import { bodiesOf, filterHidden } from "./visibility";

const $ = (id: string) => document.getElementById(id)!;
const status = $("status");
// A warning (orange) stays only while its own text is showing; any other message replaces it.
let warnedText: string | null = null;
new MutationObserver(() => {
  if (status.classList.contains("warn") && status.textContent !== warnedText) status.classList.remove("warn");
}).observe(status, { childList: true, characterData: true, subtree: true });
const selected = $("selected");
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
  import_step: "Importing", combine_step: "Combining", export_step: "Exporting", save_project: "Saving", open_project: "Opening", open_demo: "Opening",
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
  const card = $("toolform");
  const dodge = () => {
    const m = $("measure");
    m.classList.remove("aside");
    if (!card.hidden && !m.hidden && card.getBoundingClientRect().bottom > m.getBoundingClientRect().top) m.classList.add("aside");
  };
  const watch = new MutationObserver(dodge);
  for (const el of [card, $("measure")]) watch.observe(el, { attributes: true, attributeFilter: ["hidden"], childList: true, subtree: true });
  window.addEventListener("resize", dodge);
}
const dimensionOverlay = new DimensionOverlay($("viewport"), () => viewport.camera);
createSettingsWindow(document.body);
const navCube = new NavCube($("navcube"), viewport);
const reference = new ReferenceView(viewport);
const pointPicker = new PointPicker(viewport, reference, (text) => (status.textContent = text));
const seeThroughButton = $("seethrough");
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
  for (const part of [() => reference.tick(), () => dimensionOverlay.draw(), () => navCube.update()]) {
    try {
      part();
    } catch (e) {
      logOnce("frame", e);
    }
  }
};
const loggedErrors = new Set<string>();
/** Console-log an error once per kind, so a failure repeating every frame does not flood the console. */
function logOnce(kind: string, e: unknown) {
  if (loggedErrors.has(kind)) return;
  loggedErrors.add(kind);
  console.error(`Pliable ${kind} update failed (later updates continue):`, e);
}

// Tool registry from the core, the current selection, and which tool a drag runs.
let tools: ToolInfo[] = [];
let currentSels: Sel[] = [];
let refined: string[] | null = null; // ids the core says apply to currentSels (null until it replies)
let armedTool: string | null = null; // tool the user chose in the toolbar or palette

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
}

/** Tools usable with the current selection: counts checked here, the core's extra checks once it replies. */
function usableTools(): ToolInfo[] {
  return tools.filter((t) => acceptsSelection(t, expand(t, currentSels)) && (refined === null || refined.includes(t.id)));
}

/** The tool a drag on `sels` runs: the armed one if it applies, else the first with a drag parameter. */
function dragToolFor(sels: Sel[]): ToolInfo | null {
  const candidates = tools.filter((t) => dragParam(t) !== null && acceptsSelection(t, expand(t, sels)));
  return candidates.find((t) => t.id === armedTool) ?? candidates[0] ?? null;
}

/** The hole tool whose axis handles show for a selected hole face or rim (none while a drag tool is armed). */
function holeHandleTool(sels: Sel[]): ToolInfo | null {
  if (armedTool !== null || sels.length !== 1 || !refined?.includes("edit_hole")) return null;
  return tools.find((t) => t.id === "edit_hole") ?? null;
}
let selectionHandleTool: ToolInfo | null = null; // the tool the handles now shown on the selection belong to

/** With a selection and no form open, the tool a drag would run shows its handles (push/pull's arrow on the face). */
async function refreshSelectionHandles() {
  const sels = currentSels;
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
    if (currentSels !== sels || toolPanel.isOpen) return; // the selection changed or a form took over while waiting
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
  selection: () => currentSels,
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
  committed: () => committed,
  selection: () => currentSels,
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
  const body = committed ? bodiesOf(committed).find((b) => b.id === id) : undefined;
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
  if (isArrayTool(toolPanel.openToolId)) {
    void settleOpenArray().then(() => armTool(tool, surface));
    return;
  }
  if (dragParam(tool) === null) {
    toolPanel.openForm(tool, {}, surface);
    return;
  }
  usage.record(tool.id, "start", surface);
  armedTool = tool.id;
  void refreshSelectionHandles();
  renderToolbar();
  if (!status.classList.contains("error")) status.textContent = `${tool.label}: drag the selection`;
}

/** The model state made by picking a sketch region, while its face is still the only selection and nothing was done with it. */
let pendingProfile: { mesh: MeshData; faces: number[]; sketchId: number; regions: number[] } | null = null;

/** A sketch region picked in the view becomes a temporary face of the model, selected so the usual tools work on it. */
let profilePicking: Promise<void> | null = null;
function pickProfile(sketchId: number, region: number, additive = false) {
  const run = pickProfileNow(sketchId, region, additive);
  profilePicking = run.finally(() => { if (profilePicking === run) profilePicking = null; });
  return run;
}
async function pickProfileNow(sketchId: number, region: number, additive: boolean) {
  // Shift or Ctrl adds another region of the same sketch (or takes a picked one out again): all the picked regions become faces together.
  const before = additive && pendingProfile && pendingProfile.sketchId === sketchId && committed === pendingProfile.mesh ? pendingProfile.regions : [];
  const regions = before.includes(region) ? before.filter((r) => r !== region) : [...before, region];
  await dropPendingProfile();
  if (!regions.length) return setSelection([]);
  try {
    const mesh = await core.request<MeshData>("sketch_regions", { sketch_id: sketchId, region: regions[0], picked_regions: regions });
    const faces: number[] = mesh.header.selection?.faces ?? [];
    setCommitted(mesh, false, faces.map((id) => ({ kind: "face" as const, id })));
    if (faces.length) pendingProfile = { mesh, faces, sketchId, regions };
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
  const pending = pendingProfile;
  pendingProfile = null;
  if (pending && committed === pending.mesh) await history("undo");
}

/** An array form that is only a preview is open: ask to apply or discard it; resolves with the answer once the form is closed, or null at once when none is open. */
let askingArray = false;
async function settleOpenArray(): Promise<"apply" | "discard" | null> {
  if (!isArrayTool(toolPanel.openToolId) || askingArray) return null;
  askingArray = true;
  try {
    const answer = await askApplyOrDiscard(toolPanel.openToolLabel);
    if (answer === "apply") await toolPanel.apply();
    else toolPanel.close();
    return answer;
  } finally {
    askingArray = false;
  }
}

function setSelection(sels: Sel[]) {
  if (isArrayTool(toolPanel.openToolId)) {
    // Clicking away from an array being edited asks first; the click itself is not carried over (the preview's ids are not the model's).
    const before = currentSels;
    if (!askingArray) void settleOpenArray().then((answer) => { if (answer === "discard" && committed) { viewport.selectItems(before); setSelection(before); } });
    return;
  }
  if (pendingProfile && (committed !== pendingProfile.mesh || sels.length !== pendingProfile.faces.length || sels.some((s) => s.kind !== "face" || !pendingProfile!.faces.includes(s.id)))) {
    if (committed === pendingProfile.mesh && !toolPanel.isOpen) void dropPendingProfile(); // clicked away from the picked region: it was only a pick
    else pendingProfile = null; // a tool used it, or the history moved on
  }
  viewport.pullDirection.reset(); // a chosen push/pull direction belongs to the face it was chosen for
  if (sels.length && pickedRow) pickRow(null); // a body or face was picked: the Delete key leaves the sketch and datum rows
  if (toolPanel.isOpen) toolPanel.close(false); // the selection changed under an open tool form
  viewport.manipulator.clear();
  currentSels = sels;
  navCube.fitSelectedButton.disabled = sels.length === 0;
  bodyList.setSelected(sels.filter((s) => s.kind === "body").map((s) => s.id));
  refined = null;
  relatedState.rules = [];
  selected.textContent = describe(sels);
  if (sels.length === 0) {
    measurePanel.hide();
    measuredDims = []; previewDimsShown = false; dimensionOverlay.set([]);
    renderChips();
    renderToolbar();
    toolPanel.renderList();
    renderSketchBar();
    // The core knows which tools make sense with nothing selected (whole-model tools need a single body).
    core
      .request<{ tools: string[] }>("available_tools", { selection: selectionPayload(sels) })
      .then((reply) => {
        if (currentSels !== sels) return;
        refined = reply.tools;
        renderToolbar();
        toolPanel.renderList();
      })
      .catch((e) => logOnce("available tools", e));
    return;
  }
  // Wait for the core's answers and render once: rendering the count-only guess first, then the refined set,
  // made tools flip between enabled and greyed and the chips blink on every face click.
  const rules = sels.length === 1 && sels[0].kind === "face" ? core.request<{ rules: RelatedRule[] }>("related", { face: sels[0].id }) : Promise.resolve({ rules: [] as RelatedRule[] });
  const available = core.request<{ tools: string[] }>("available_tools", { selection: selectionPayload(sels) });
  Promise.allSettled([rules, available]).then(([rulesReply, availableReply]) => {
    if (currentSels !== sels) return; // the selection changed while waiting
    relatedState.rules = rulesReply.status === "fulfilled" ? rulesReply.value.rules : [];
    refined = availableReply.status === "fulfilled" ? availableReply.value.tools : null;
    void refreshSelectionHandles();
    renderChips();
    renderToolbar();
    toolPanel.renderList();
    renderSketchBar();
  });
  core
    .request<MeasureReply>("measure", { selection: selectionPayload(sels) })
    .then((reply) => {
      // Not while a drag is live (the panel is hidden then); never on a stale dragSels left by a drag that failed to end.
      if (currentSels === sels && !viewport.dragging) {
        measurePanel.show(reply);
        measuredDims = withoutDraftTag(reply.dimensions ?? []);
        previewDimsShown = false;
        dimensionOverlay.set(measuredDims);
      }
    })
    .catch((e) => {
      logOnce("measurement", e);
      if (currentSels === sels) {
        measurePanel.hide();
        measuredDims = []; previewDimsShown = false; dimensionOverlay.set([]);
      }
    });
}

function selectionPayload(sels: Sel[]) {
  const ids = (kind: Sel["kind"]) => sels.filter((s) => s.kind === kind).map((s) => s.id);
  return { faces: ids("face"), edges: ids("edge"), vertices: ids("vertex"), bodies: ids("body") };
}

let committed: MeshData | null = null; // last committed (non-preview) mesh
/** The newest committed tool run, kept while nothing else has changed the model: "Edit last" undoes it and reopens its form. */
let lastOp: { tool: ToolInfo; sels: Sel[]; values: Record<string, ParamValue> } | null = null;


/** Tells the list of kept sketches what the document holds; set once that list exists. */
let onSketches: (list: { id: number; name: string; rev: number }[]) => void = () => {};
let onDatums: (list: DatumPlane[], mirror: MirrorMode | null) => void = () => {};

/** The dimensions of the committed model's measurement, and whether a preview's own are on screen instead. */
let measuredDims: Dimension[] = [];
let previewDimsShown = false;

function show(mesh: MeshData, frame = false) {
  // A preview that keeps one face or edge selected (a hole being moved) brings the dimensions of its own model.
  const previewDims: Dimension[] | undefined = mesh.header.preview ? mesh.header.dimensions : undefined;
  if (previewDims) {
    dimensionOverlay.set(previewDims);
    previewDimsShown = true;
  } else if (previewDimsShown && !mesh.header.preview) {
    dimensionOverlay.set(measuredDims); // the preview ended without a commit: the committed model's dimensions again
    previewDimsShown = false;
  }
  bodyView.hidden = pruneHidden(bodyView.hidden, bodiesOf(mesh).map((b) => b.id));
  const pruned = pruneGhost(bodyView.ghost, bodyView.focus, bodiesOf(mesh).map((b) => b.id));
  bodyView.ghost = pruned.ghost;
  bodyView.focus = pruned.focus;
  viewport.setMesh(filterHidden(mesh, bodyView.hidden), frame);
  viewport.setGhosted(bodyView.ghost);
  if (!mesh.header.preview) {
    bodyList.setBodies(bodiesOf(mesh), bodyView.hidden, bodyView.ghost, bodyView.focus?.body ?? null);
    onSketches(mesh.header.sketches ?? []);
    onDatums(mesh.header.datums ?? [], mesh.header.mirror ?? null);
  }
  modelHistory = { undo: !!mesh.header.canUndo, redo: !!mesh.header.canRedo };
  syncHistoryButtons();
}

let modelHistory = { undo: false, redo: false }; // what the model itself can undo and redo, kept while a sketch is edited

/** The top bar's Undo and Redo follow the sketch's edits while a sketch is open, and the model's otherwise. */
function syncHistoryButtons() {
  undoButton.disabled = sketch.active ? !sketch.canUndo : !modelHistory.undo;
  redoButton.disabled = sketch.active ? !sketch.canRedo : !modelHistory.redo;
}

function describe(sels: Sel[]): string {
  if (sels.length === 0) return "";
  if (sels[0].kind === "body") {
    const name = (id: number) => (committed ? bodiesOf(committed).find((b) => b.id === id)?.name : undefined) ?? `body ${id}`;
    return sels.length === 1 ? name(sels[0].id) : `${sels.length} bodies`;
  }
  return sels.length === 1 ? `${sels[0].kind} ${sels[0].id}` : `${sels.length} ${sels[0].kind}s`;
}

/** The selection a reply says the old selection maps to. */
function mappedSelection(mesh: MeshData): Sel[] {
  const s = mesh.header.selection ?? {};
  const result: Sel[] = [];
  for (const [key, kind] of [["faces", "face"], ["edges", "edge"], ["vertices", "vertex"], ["bodies", "body"]] as const) {
    for (const id of s[key] ?? []) result.push({ kind, id });
  }
  return result;
}

function setCommitted(mesh: MeshData, frame = false, sels: Sel[] = []) {
  committed = mesh;
  lastOp = null; // callers that commit a tool run set it again afterwards
  editLastButton.disabled = true;
  if (frame) { // a newly opened model: its body ids restart at 1, so the old model's hidden, see-through and focus state would hit its bodies
    bodyView.hidden = new Set();
    bodyView.ghost = new Set();
    bodyView.focus = null;
  }
  show(mesh, frame);
  viewport.selectItems(sels);
  setSelection(sels);
  status.classList.remove("error");
  const warnings: string[] = mesh.header.warnings ?? [];
  if (mesh.header.solids !== undefined) showImportNotice(core, mesh.header.solids, warnings, (mesh.header.timings?.importMs ?? 0) + (mesh.header.timings?.meshMs ?? 0));
  status.textContent = `${mesh.header.name ?? loadedSample}: ${mesh.faces.length} faces` + (DEV ? `, ${mesh.indices.length / 3} triangles` : "") + (warnings.length ? ` | Warning: ${warnings.join("; ")}` : "");
}

async function load(name: string) {
  status.textContent = `loading ${name}...`;
  setCommitted(await core.openDemo(name), true);
}

// Push/pull drag: one preview request in flight, the newest distance wins.
let session = 0; // bumped when a drag ends, so late replies are dropped
let inFlight: Promise<void> | null = null;
let queued: number | null = null;
let lastGood: number | null = null; // newest distance whose preview succeeded
let previewFailed = false; // the newest preview request failed (size past the limit)
let dragSels: Sel[] | null = null;

// Shift held when a push/pull drag starts makes the whole drag symmetric (about a plane, see the core's symmetric push/pull).
let shiftHeld = false;
let dragSymmetric = false;
for (const type of ["keydown", "keyup"] as const) {
  window.addEventListener(type, (e) => {
    shiftHeld = e.shiftKey;
    // Pressing or letting go of Shift during a push/pull drag switches the symmetric mode from then on and previews it at once.
    if (dragSels !== null && dragToolFor(dragSels)?.id === "push_pull" && dragSymmetric !== shiftHeld) {
      dragSymmetric = shiftHeld;
      queued = dragValue;
      pump(session);
    }
  });
}
window.addEventListener("blur", () => (shiftHeld = false));

function toolRequest(sels: Sel[], distance: number, commit = false) {
  const tool = dragToolFor(sels)!;
  const params: Record<string, number> = { [dragParam(tool)!]: distance };
  if (tool.id === "push_pull" && dragSymmetric) params.symmetric = 1;
  if (tool.id === "push_pull") Object.assign(params, viewport.pullDirection.params()); // the chosen direction (pulldir.ts), for the arrow handle and the face drag alike
  // Pulling a just-picked sketch region: the pick and the extrusion are one undo step.
  const foldPick = commit && pendingProfile !== null && committed === pendingProfile.mesh ? { foldPick: true } : {};
  return { tool: tool.id, selection: selectionPayload(expand(tool, sels)), params, ...foldPick };
}

function pump(token: number) {
  if (inFlight || queued === null || dragSels === null) return;
  const distance = queued;
  queued = null;
  const sent = performance.now();
  inFlight = core
    .request<MeshData>("tool_preview", toolRequest(dragSels, distance))
    .then((mesh) => {
      if (token !== session) return;
      lastGood = distance;
      previewFailed = false;
      status.classList.remove("error");
      show(mesh);
      viewport.selectItems(mappedSelection(mesh));
      const t = mesh.header.timings ?? {};
      latency.textContent = `preview ${Math.round(performance.now() - sent)} ms (op ${t.opMs} + mesh ${t.meshMs})`;
    })
    .catch((e) => {
      if (token !== session) return;
      // Keep showing the last size that worked (smooth), but say plainly that the
      // requested size is past the limit; releasing commits the last good size.
      previewFailed = true;
      status.textContent = lastGood === null ? e.message : `limit reached (${e.message})`;
      status.classList.add("error");
    })
    .finally(() => {
      inFlight = null;
      pump(token);
    });
}

viewport.onSelect = setSelection;

// Editing a displayed dimension in place (dimedit.ts): the core maps it to the matching tool, so it previews like one and is one undo step.
const dimensionEditor = new DimensionEditor({
  overlay: dimensionOverlay,
  container: $("viewport"),
  send: (edit, value, flip, commit) => core.request("dimension_edit", { selection: selectionPayload(currentSels), dimension: edit.kind, value, flip, commit }),
  preview: (reply) => {
    show(reply as MeshData);
    status.classList.remove("error");
  },
  revert: () => {
    if (committed) show(committed);
  },
  committed: (reply, summary) => {
    const mesh = reply as MeshData;
    setCommitted(mesh, false, mappedSelection(mesh));
    status.textContent = summary;
  },
});
void dimensionEditor;
viewport.onHoverBody = (id) => bodyList.setHovered(id);

// Moving a hole by dragging its centre dot: previews the Move hole tool (latest request wins) and commits on release.
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
    status.textContent = `Move hole: ${offset.x.toFixed(2)}, ${offset.y.toFixed(2)}, ${offset.z.toFixed(2)}`;
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
    if (committed) show(committed);
    return;
  }
  const req = centreRequest(face, { x: offset.x, y: offset.y, z: offset.z });
  if (!req) return;
  try {
    const mesh = await core.request<MeshData>("tool_commit", req);
    setCommitted(mesh, false, mappedSelection(mesh));
  } catch (e) {
    if (committed) setCommitted(committed, false, currentSels);
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
  const own = currentSels.length === 1 && currentSels[0].kind === "face" && sel.kind === "face" && sel.id === currentSels[0].id;
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
    const sels = additive ? [...currentSels.filter((s) => s.kind === "edge" && !edges.includes(s.id)), ...picked] : picked;
    viewport.selectItems(sels);
    setSelection(sels);
    status.textContent = `${picked.length} edge${picked.length === 1 ? "" : "s"} selected by double-click (edges that continue smoothly from this one; Ctrl+double-click adds them to the selection)`;
  } catch (e) {
    status.textContent = (e as Error).message;
  }
};

// Dimension label: follows the pointer during a drag; typing digits turns it into the value entry.
const dimLabel = $("dim");
const DIM_OFFSET_PX = 16; // label offset from the pointer
const len = (n: number) => `${n.toFixed(2)} ${LENGTH_UNIT}`;
let typed: string | null = null; // text typed so far, null while the mouse sets the value
let dragValue = 0; // value from the mouse (model units)
let typedNegative = false; // sign of the typed value: starts as the drag direction, "-" flips it

/** The number sent to the core: the typed value if it parses, else the mouse value. */
function effectiveValue(): number {
  const n = typed === null || typed === "" ? NaN : Number(typed);
  if (!Number.isFinite(n)) return dragValue;
  const m = viewport.measureMode ? viewport.measureSel : null;
  // In measure mode the typed number is the edge's new length; the face moves by the difference.
  return m ? m.grow * (n - m.length) : typedNegative ? -n : n;
}

function renderDim() {
  const entering = typed !== null;
  dimLabel.classList.toggle("entry", entering);
  const m = viewport.measureSel ?? viewport.primaryMeasure;
  const was = m ? len(m.length) : "";
  if (viewport.measureMode && m) {
    const shown = entering ? `${typed}| ${LENGTH_UNIT}` : len(m.length + m.grow * effectiveValue());
    dimLabel.textContent = `edge ${shown}\nwas ${was} (face ${len(effectiveValue())})`;
    return;
  }
  const value = entering ? `${typedNegative ? "-" : ""}${typed}| ${LENGTH_UNIT}` : len(dragValue);
  const context = m ? `\nedge ${was} → ${len(m.length + m.grow * dragValue)}` : "";
  dimLabel.textContent = value + context;
}

// Right-click during a drag toggles measure mode; picking another edge or leaving it drops any typed text.
viewport.onMeasureChange = () => {
  typed = null;
  if (viewport.measureMode) {
    status.classList.remove("error");
    status.textContent = "Measure mode: click an edge, type its length, Enter to apply, Esc to go back";
  }
  renderDim();
};

function hideDim() {
  typed = null;
  dimLabel.hidden = true;
}

window.addEventListener("keydown", (e) => {
  // A direction arc being dragged owns the keyboard too: typed degrees set its tilt (see PullGizmo.key).
  if (viewport.pullGizmo.dragging && !e.ctrlKey && !e.metaKey && !e.altKey && viewport.pullGizmo.key(e)) {
    e.preventDefault();
    return;
  }
  // A handle being dragged owns the keyboard: typed digits set its value (see Manipulator.key).
  if (viewport.manipulator.dragging && !e.ctrlKey && !e.metaKey && !e.altKey && viewport.manipulator.key(e)) {
    e.preventDefault();
    return;
  }
  if (!viewport.dragging || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^[0-9.-]$/.test(e.key)) {
    if (e.key === "-" && viewport.measureMode) return; // lengths are not signed
    if (typed === null) {
      typed = "";
      typedNegative = dragValue < 0; // the drag already chose the direction
      viewport.holdDrag = true;
    }
    if (e.key === "-") typedNegative = !typedNegative;
    else typed += e.key;
  } else if (e.key === "Backspace" && typed !== null) {
    typed = typed.slice(0, -1);
  } else if (e.key === "Enter" && typed !== null) {
    viewport.finishDrag();
    return;
  } else if (e.key === "Escape" && typed !== null) {
    // Button still held (or measure mode): the first Escape leaves entry and goes back to the mouse. Button already up: Escape cancels the drag.
    if (!viewport.measureMode && viewport.dragReleased) {
      typed = null;
      viewport.cancelDrag();
      return;
    }
    typed = null;
    viewport.holdDrag = viewport.measureMode;
    renderDim();
    return;
  } else if (e.key === "Escape" && viewport.measureMode) {
    viewport.exitMeasure();
    return;
  } else return;
  // The preview stays where the mouse left it until Enter, so entry can finish before geometry moves.
  e.preventDefault();
  renderDim();
});

viewport.onItemDrag = async (sels, distance, phase, x = 0, y = 0) => {
  if (phase === "move") {
    if (!dragToolFor(sels)) return;
    dragValue = distance;
    dimLabel.hidden = false;
    measurePanel.hide();
    measuredDims = []; previewDimsShown = false; dimensionOverlay.set([]);
    dimLabel.style.left = `${x + DIM_OFFSET_PX}px`;
    dimLabel.style.top = `${y + DIM_OFFSET_PX}px`;
    renderDim();
    if (dragSels === null) {
      lastGood = null;
      previewFailed = false;
      dragSymmetric = shiftHeld;
      const dragTool = dragToolFor(sels)!;
      if (armedTool !== dragTool.id) usage.record(dragTool.id, "start", "drag"); // an armed tool already counted its start
    }
    dragSels = sels;
    queued = distance;
    pump(session);
    return;
  }
  // End or cancel: stop previews, let the in-flight one finish, then settle.
  if (phase === "end" && typed !== null) distance = effectiveValue();
  else if (phase === "end") distance = dragValue;
  hideDim();
  session++;
  queued = null;
  try {
    await inFlight;
  } catch {
    // a failed preview must not leave the drag state set
  }
  dragSels = null;
  const good = lastGood;
  if (phase === "end" && previewFailed && good !== null) distance = good;
  lastGood = null;
  previewFailed = false;
  const dragTool = dragToolFor(sels);
  try {
    if (!(phase === "end" && Math.abs(distance) > 1e-6) && dragTool) usage.record(dragTool.id, "cancel");
    if (phase === "end" && Math.abs(distance) > 1e-6) {
      const start = performance.now();
      let mesh: MeshData;
      try {
        mesh = await core.request<MeshData>("tool_commit", toolRequest(sels, distance, true));
      } catch (e) {
        // The final size can fail when the last preview reply was dropped at release;
        // fall back to the newest size known to work.
        if (good === null || good === distance) throw e;
        mesh = await core.request<MeshData>("tool_commit", toolRequest(sels, good, true));
      }
      setCommitted(mesh, false, mappedSelection(mesh));
      rememberOp(dragToolFor(sels), sels, distance);
      if (dragTool) usage.record(dragTool.id, "commit");
      latency.textContent = `commit ${Math.round(performance.now() - start)} ms`;
    } else if (committed) {
      setCommitted(committed, false, sels);
    }
  } catch (e) {
    if (dragTool) usage.record(dragTool.id, "error");
    if (committed) setCommitted(committed, false, sels);
    status.textContent = (e as Error).message; // after setCommitted, which rewrites the status
    status.classList.add("error");
  }
  dragSymmetric = false;
};

const editLastButton = $("editlast") as HTMLButtonElement;

function rememberOp(tool: ToolInfo | null, sels: Sel[], distance: number) {
  const param = tool && dragParam(tool);
  if (!tool || !param) return;
  lastOp = { tool, sels, values: { [param]: distance } };
  editLastButton.disabled = false;
}

editLastButton.addEventListener("click", async () => {
  const op = lastOp;
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
  committed: () => committed,
  selection: () => currentSels,
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
      if (currentSels.length === 1 && currentSels[0].kind === "face" && !viewport.alignToFace(currentSels[0].id)) status.textContent = "Look at face: could not find a view direction for this face";
    },
    measure: () => viewport.toggleMeasureKey(),
    "display.drawer": () => toggleDrawer(),
    "display.hide": () => setVisibility("hide"),
    "display.isolate": () => setVisibility("isolate"),
    "display.showAll": () => setVisibility("show"),
    "history.undo": () => void history("undo"),
    "history.redo": () => void history("redo"),
    "sketch.smartDimension": () => sketch.chooseConstraint("Dimension"),
    ...Object.fromEntries(["sketch.undo", "sketch.redo", "sketch.cancel", "sketch.finish", "sketch.delete"].map((id) => [id, (e: KeyboardEvent) => sketch.onKey(e)])),
  },
  entryActive: () => viewport.dragging || dragSels !== null || viewport.manipulator.dragging || viewport.pullGizmo.dragging,
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
  if (modelHistory.undo || sketch.active) e.preventDefault();
});

installFileOpening(
  { core, status, hasEdits: () => modelHistory.undo, setCommitted: (mesh, frame) => setCommitted(mesh as MeshData, frame) },
  { open: $("open"), openAsNew: $("openasnew"), openProject: $("openproject"), newProject: $("newproject") },
  { step: fileInput, project: $("projectfile") as HTMLInputElement },
);

/** Ask the core for the model in a file format and save it through the browser. */
const exportAs = (request: string, extension: string, params: Record<string, unknown> = {}) => saveModel(core, status, loadedSample || "model", request, extension, params);

$("export").addEventListener("click", () => exportAs("export_step", "step"));
$("saveproject").addEventListener("click", () => exportAs("save_project", "plbl"));
const exportMesh = $("exportmesh") as HTMLSelectElement;
exportMesh.addEventListener("change", () => {
  const format = exportMesh.value;
  exportMesh.value = "";
  if (format) void exportAs("export_mesh", format, { format });
});

select.addEventListener("change", () => {
  const name = select.value;
  select.value = ""; // back to the prompt, so any sample (the first too) can be chosen again
  if (!name) return;
  if (modelHistory.undo && !window.confirm("Opening a sample model replaces the current model and its undo history. Continue?")) return;
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
    enabled: usable.has(tool.id),
    run: () => armTool(tool, "search"),
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
    { label: "Hide body", scope: "body", hint: keys.keymap.hint("display.hide"), enabled: currentSels.length > 0, run: () => setVisibility("hide") },
    { label: "Isolate body", scope: "body", hint: keys.keymap.hint("display.isolate"), enabled: currentSels.length > 0, run: () => setVisibility("isolate") },
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
    { label: "Import STEP file (add to model)", scope: "file", enabled: true, run: () => $("open").click() },
    { label: "New project (empty)", scope: "file", keywords: ["blank", "clear"], enabled: true, run: () => $("newproject").click() },
    { label: "Open STEP file as new project", scope: "file", enabled: true, run: () => $("openasnew").click() },
    ...(["XY", "XZ", "YZ"] as const).map((plane) => ({ label: `Add datum plane: ${plane} origin plane`, scope: "file" as const, keywords: ["helper plane", "construction", "mirror"], enabled: true, run: () => addDatum({ plane }) })),
    ...(["XY", "XZ", "YZ"] as const).map((plane) => ({ label: `Mirror mode on: ${plane} origin plane`, scope: "file" as const, keywords: ["symmetry", "symmetric", "mirror"], enabled: true, run: () => keptRequest("mirror_set", { plane }) })),
    { label: "Mirror mode on: the selected face", scope: "file", keywords: ["symmetry", "symmetric", "mirror"], enabled: currentSels.length === 1 && currentSels[0].kind === "face", run: () => keptRequest("mirror_set", { face: currentSels[0].id, name: "Selected face" }) },
    ...datumPlanes.planes.map((d) => ({ label: `Mirror mode on: datum plane ${d.name}`, scope: "file" as const, keywords: ["symmetry", "symmetric", "mirror"], enabled: true, run: () => keptRequest("mirror_set", { datum_id: d.id }) })),
    { label: "Mirror mode off", scope: "file", keywords: ["symmetry", "symmetric", "mirror"], enabled: true, run: () => keptRequest("mirror_clear", {}) },
    { label: "Add datum plane on the selected face", scope: "file", keywords: ["helper plane", "construction", "mirror"], enabled: currentSels.length === 1 && currentSels[0].kind === "face", run: () => addDatum({ face: currentSels[0].id }) },
    { label: "Add datum plane midway between two selected faces", scope: "file", keywords: ["helper plane", "construction", "mirror", "middle"], enabled: currentSels.length === 2 && currentSels.every((s) => s.kind === "face"), run: () => addDatum({ midplane: currentSels.map((s) => s.id) }) },
    { label: "Export STEP file", scope: "file", enabled: true, run: () => exportAs("export_step", "step") },
    { label: "Save project (.plbl file with bodies, names and sketches)", scope: "file", keywords: ["save", "pliable file"], enabled: true, run: () => exportAs("save_project", "plbl") },
    { label: "Open project (.plbl file)", scope: "file", keywords: ["load", "pliable file"], enabled: true, run: () => $("openproject").click() },
    ...["stl", "obj", "3mf"].map((format) => ({
      label: `Export ${format.toUpperCase()} mesh (lossy)`,
      scope: "file" as const,
      keywords: ["save", "download", "print"],
      enabled: true,
      run: () => exportAs("export_mesh", format, { format }),
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
      if (committed) show(committed);
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
  renderToolbar();
  syncHistoryButtons();
  navCube.fitSelectedButton.disabled = sketch.active ? !sketch.selection.length : currentSels.length === 0; // in a sketch the fit button follows the sketch selection
};
/** Run a request that changes the kept sketches and takes the document state it answers with. */
function keptRequest(kind: string, args: Record<string, unknown>) {
  core
    .request<MeshData>(kind, args)
    .then((mesh) => setCommitted(mesh, false, currentSels))
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
let pickedRow: RowRef | null = null;
function pickRow(row: RowRef | null) {
  pickedRow = row;
  keptSketches.setPicked(row?.list === "sketch" ? row.id : null);
  datumPlanes.setPicked(row?.list === "datum" ? row.id : null);
  if (row && currentSels.length) {
    viewport.selectItems([]);
    setSelection([]);
  }
}
window.addEventListener("keydown", (e) => {
  const action = deleteAction(e.key, {
    bodies: currentSels.filter((s) => s.kind === "body").map((s) => s.id),
    row: pickedRow,
    typing: isTyping(e.target),
    blocked: sketch.active || toolPanel.isOpen || e.ctrlKey || e.metaKey || e.altKey || viewport.dragging || dragSels !== null,
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
  selection: () => currentSels,
  status(text, error = false) {
    status.textContent = text;
    status.classList.toggle("error", error);
  },
  diagnostics: () => showDiagnostics(core),
});
const hintLine = new HintLine(
  $("viewport"),
  () => ({ dragging: viewport.dragging || dragSels !== null, sketch: sketch.active, hasSelection: currentSels.length > 0 }),
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
  const face = toolPanel.openToolId === "divide_face" && currentSels.length === 1 && currentSels[0].kind === "face" ? currentSels[0].id : null;
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
viewport.onDivideDrag = (across, offset) => toolPanel.setValues({ across, offset });

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
  const seq = ++formPreviewSeq;
  const t0 = performance.now();
  const sentValue = slideLive?.value;
  try {
    const mesh = await core.request<MeshData>("tool_preview", { tool: tool.id, selection: selectionPayload(editBody === undefined ? expand(tool, currentSels) : []), params: values, ...(editBody === undefined ? {} : { edit_body: editBody }) });
    const t1 = performance.now();
    if (!toolPanel.isOpen || seq !== formPreviewSeq) return; // closed or a newer preview was asked for
    show(mesh);
    if (slideLive && sentValue !== undefined) {
      // Which bodies a move arrow moves is read off two previews of the same drag (their centres shift along the arrow).
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

const toolPanel = new ToolPanel($("toollist"), $("toolform"), {
  selectedEdges: () => currentSels.filter((s) => s.kind === "edge").map((s) => s.id),
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
  usable: (tool) => acceptsSelection(tool, expand(tool, currentSels)) && (refined === null || refined.includes(tool.id)),
  preview(tool, values, editBody) {
    // One preview in flight at a time, the newest request waiting behind it (latest wins): the core answers in order, so
    // sending every pointer move would show nothing until the pointer rests while the replies queue up.
    previewWaiting = { tool, values, editBody };
    if (!previewBusy) void drainPreviews();
    return Promise.resolve();
  },
  async commit(tool, values, editBody) {
    const sels = currentSels;
    try {
      const mesh = await core.request<MeshData>("tool_commit", { tool: tool.id, selection: selectionPayload(editBody === undefined ? expand(tool, sels) : []), params: values, ...(editBody === undefined ? {} : { edit_body: editBody }) });
      setCommitted(mesh, false, mappedSelection(mesh));
      lastOp = { tool, sels, values };
      editLastButton.disabled = false;
      usage.record(tool.id, "commit");
    } catch (e) {
      usage.record(tool.id, "error");
      if (committed) setCommitted(committed, false, sels);
      status.textContent = (e as Error).message;
      status.classList.add("error");
    }
  },
  eyedrop(param, kind) {
    return new Promise((resolve) => {
      cancelEyedrop();
      if (committed) show(committed); // pick against the committed model, whose ids the core knows
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
  cancelEyedrop,
  changed: () => {
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
    if (committed) {
      show(committed);
      status.classList.remove("error");
    }
  },
});
toolPanel.renderList();
// A handle dragged in the view sets its parameter through the open form, so typed entry and the preview stay in step.
// With no form open (a selection waiting for its drag tool) the handle runs that tool's normal drag instead.
let lastDragEvent = 0;
// The value arrow of the selection's drag tool (push/pull's) starts the same drag as pressing the face: measure pick, typed value, Shift.
viewport.handleStartsItemDrag = (info) =>
  !toolPanel.isOpen && selectionHandleTool?.id === "push_pull" && !info.toggle && info.param === dragParam(selectionHandleTool);
viewport.manipulator.onDrag = (param, value, phase, x, y, linked) => {
  lastDragEvent = performance.now();
  if (sketch.onPlaneDrag(param, value, phase)) return; // a sketch's plane gizmo
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
  } else void viewport.onItemDrag(currentSels, phase === "cancel" ? 0 : value, phase, x, y);
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
  const hadModel = committed !== null;
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
  if (e.key !== "Escape" || e.defaultPrevented || !currentSels.some((s) => s.kind === "body")) return;
  if (toolPanel.isOpen || viewport.dragging || (e.target as HTMLElement).closest?.("input, textarea")) return;
  viewport.selectItems([]);
  setSelection([]);
});
