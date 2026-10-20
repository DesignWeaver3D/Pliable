import * as THREE from "three";
import { moveHandlesAt } from "./placepick";
import { bodyCentres, movedBodies } from "./slide";
import { PointPicker, ReferenceView } from "./reference";
import { installAlphaUi, showDiagnostics, showImportNotice, showLaunchNotice } from "./alpha";
import { CoreClient, type MeshData } from "./client";
import { SKETCH_TOOLS, SketchMode } from "./sketch";
import type { Tool as SketchTool } from "./sketch";
import { SketchBar } from "./sketchbar";
import { ToolPanel, type ParamValue } from "./toolpanel";
import { NavCube, VIEW_KEYS } from "./navcube";
import { fitStripCount, stripRoom } from "./stripfit";
import { DimensionOverlay, type Dimension } from "./dimensions";
import { DimensionEditor } from "./dimedit";
import { KeptSketches } from "./keptsketches";
import { LatestWins } from "./latestwins";
import { LENGTH_UNIT } from "./units";
import { SETTING_ENTRIES, createSettingsWindow, onSettingsChange, openSettings, setHintsBinding, setKeysOpener, settingValue, settings } from "./settings";
import { MeasurePanel, type MeasureReply } from "./measure";
import { KeyRouter } from "./keyrouter";
import { HintLine } from "./hints";
import { Palette, type Command } from "./palette";
import { toolKeywords } from "./search";
import { TOOLS_HANDLE_ICON, sketchIcon, toolIcon, uiIcon } from "./icons";
import { TOOL_GROUPS } from "./layout";
import type { AnchorInfo } from "./placepick";
import { acceptsSelection, describeNeeds, dragParam, toolTooltip, type HandleInfo, type ToolInfo } from "./tools";
import { Viewport, type Sel } from "./viewport";
import { usage, type Surface } from "./usage";
import { BodyList } from "./bodylist";
import { pruneGhost, pruneHidden, toggleFocus, toggleGhost, toggleHidden, toggleIsolated, type FocusState } from "./bodylogic";
import { bodiesOf, filterHidden } from "./visibility";

const $ = (id: string) => document.getElementById(id)!;
const status = $("status");
const selected = $("selected");
const DEV = new URLSearchParams(location.search).has("dev"); // ?dev=1 shows triangle counts and timings
const latency = $("latency");
if (!DEV) latency.hidden = true;
const undoButton = $("undo") as HTMLButtonElement;
const redoButton = $("redo") as HTMLButtonElement;
const fileInput = $("file") as HTMLInputElement;
const select = $("demo") as HTMLSelectElement;
const viewport = new Viewport($("viewport"));
const core = new CoreClient();
usage.attach(core);
installAlphaUi($("bar"), core);

const BUSY_LABELS: Record<string, string> = {
  import_step: "Importing", combine_step: "Combining", export_step: "Exporting", open_demo: "Opening",
  restore_session: "Restoring", tool_commit: "Applying", sketch_extrude: "Building", undo: "Undoing", redo: "Redoing",
};
const busyBox = $("busy");
const busyText = $("busytext");
core.onBusy = (busy) => {
  busyBox.hidden = busy === null;
  if (busy) busyText.textContent = `${BUSY_LABELS[busy.type] ?? "Working"}... ${Math.floor(busy.seconds)} s`;
};
const measurePanel = new MeasurePanel($("measure"));
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

// Relationship rules: faces related to the selected face by a rule that is on
// are highlighted and join the selection of tools that declare the rule.
interface RelatedRule {
  id: string;
  label: string;
  faces: number[];
}
let related: RelatedRule[] = [];
// What a tool applies to is decided per tool: a saved choice for the tool, else a saved choice for all tools,
// else the tool's own default, else the base default. Until a rule is defined for a tool, its chip is shown but off.
const BASE_RULES: Record<string, boolean> = { coplanar: false, parallel: false, equal_radius: false, coaxial: false, symmetric: false };
const TOOL_RULES: Record<string, Record<string, boolean>> = { resize_hole: { equal_radius: true } };
const RULES_KEY = "pliable.rules";
let ruleChoices: Record<string, boolean> = {};
try {
  ruleChoices = JSON.parse(localStorage.getItem(RULES_KEY) ?? "{}");
} catch {
  /* storage can be blocked */
}
function ruleFor(toolId: string | null, rule: string): boolean {
  return ruleChoices[`${toolId}:${rule}`] ?? ruleChoices[`*:${rule}`] ?? (toolId ? TOOL_RULES[toolId]?.[rule] : undefined) ?? BASE_RULES[rule] ?? false;
}
/** The tool the chips speak for: the armed tool, else the open form's tool, else none (a choice for all tools). */
function chipTool(): string | null {
  return armedTool ?? toolPanel.openToolId;
}
function setRule(toolId: string | null, rule: string, on: boolean) {
  ruleChoices[`${toolId ?? "*"}:${rule}`] = on;
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify(ruleChoices));
  } catch {
    /* ignore */
  }
}

/** The selection a tool runs on: the picked items plus the faces of its related rules that are switched on. */
function expand(tool: ToolInfo | null, sels: Sel[]): Sel[] {
  if (!tool?.related?.length || sels.length !== 1 || sels[0].kind !== "face") return sels;
  const extra = new Set<number>();
  for (const rule of related) if (tool.related.includes(rule.id) && ruleFor(tool.id, rule.id)) rule.faces.forEach((f) => extra.add(f));
  return [...sels, ...[...extra].filter((f) => f !== sels[0].id).map((id) => ({ kind: "face" as const, id }))];
}

const chips = $("chips");
function renderChips() {
  const shown = related.filter((r) => r.faces.length);
  const ctx = chipTool();
  const ruleOn = (id: string) => ruleFor(ctx, id);
  const all = (label: string, on: boolean) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.className = "all";
    b.title = on ? "Include every related face shown here in the selection" : "Include none of the related faces; tools change only the selected face";
    b.addEventListener("click", () => {
      for (const rule of shown) setRule(ctx, rule.id, on);
      renderChips();
      renderToolbar();
      toolPanel.renderList();
    });
    return b;
  };
  chips.replaceChildren(
    ...(shown.length > 1 ? [all("All", true), all("None", false)] : []),
    ...shown.map((rule) => {
      const b = document.createElement("button");
      const n = rule.faces.length;
      const what = `${rule.label.toLowerCase()} face${n === 1 ? "" : "s"}`;
      b.textContent = `${ruleOn(rule.id) ? "✔ With" : "+ Add"} ${n} ${what}`;
      b.className = ruleOn(rule.id) ? "on" : "";
      b.title = ruleOn(rule.id) ? `The ${n} ${what} are included with the selected face; click to exclude them` : `The ${n} ${what} are not included yet; click to include them with the selected face`;
      b.addEventListener("click", () => {
        setRule(ctx, rule.id, !ruleOn(rule.id));
        renderChips();
        renderToolbar();
        toolPanel.renderList();
      });
      return b;
    }),
  );
  const faces = new Set<number>();
  for (const rule of shown) if (ruleOn(rule.id)) rule.faces.forEach((f) => faces.add(f));
  viewport.setRelated([...faces].map((id) => ({ kind: "face" as const, id })));
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
    const reply = await core.request<{ handles: HandleInfo[] }>("tool_handles", { tool: tool.id, selection: selectionPayload(expand(tool, sels)), params: {} });
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
  document.documentElement.style.setProperty("--leftw", open ? "492px" : "212px");
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

/** Strip order: the tool a drag runs first, then the tool groups' order. */
const GROUP_ORDER = TOOL_GROUPS.flatMap((g) => g.tools);

/** Room for the context strip: between the left side (body list, open drawer with its handle) and the right side (nav cube and view controls). */
function stripWidthAvailable(): { width: number; centre: number } {
  const vw = document.documentElement.clientWidth;
  const left = drawer.hidden ? LEFT_RESERVE_PX : DRAWER_RESERVE_PX;
  const cube = $("navcube").getBoundingClientRect();
  const right = cube.width > 0 ? vw - cube.left + 12 : 160;
  return stripRoom(vw, left, right);
}
const DRAWER_RESERVE_PX = 532; // list, drawer and its handle
const LEFT_RESERVE_PX = 240;

let toolbarKey = "";

/** While a sketch is open the top strip holds the drawing tools instead of the model's tools. The sketch itself is made below. */
let currentSketchTool: () => SketchTool = () => "select";
let chooseSketchTool: (tool: SketchTool) => void = () => {};

function renderSketchStrip() {
  const room = stripWidthAvailable();
  const available = Math.round(room.width);
  const centre = Math.round(room.centre);
  const tool = currentSketchTool();
  const key = `sketch|${tool}|${available}|${centre}`;
  if (key === toolbarKey) return;
  toolbarKey = key;
  toolbar.classList.add("sketching");
  toolbar.style.maxWidth = `${available}px`;
  toolbar.style.left = `${centre}px`;
  toolbar.replaceChildren(
    ...SKETCH_TOOLS.map((t) => {
      const button = document.createElement("button");
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = t.label;
      button.append(sketchIcon(t.id), label);
      button.title = `${t.label}: ${t.hint}`;
      button.className = t.id === tool ? "active" : "";
      button.addEventListener("click", () => chooseSketchTool(t.id));
      return button;
    }),
  );
}

function renderToolbar() {
  if (viewport.interceptor) {
    renderSketchStrip(); // a sketch is open
    return;
  }
  toolbar.classList.remove("sketching");
  renderChips();
  const usable = usableTools();
  const active = dragToolFor(currentSels)?.id;
  const helperKey = helperSignature();
  const room = stripWidthAvailable();
  const available = Math.round(room.width);
  const centre = Math.round(room.centre);
  const key = `${usable.map((t) => t.id).join(",")}|${active}|${currentSels.length}|${helperKey}|${available}|${centre}`;
  if (key === toolbarKey) return; // unchanged: keep the buttons (avoids flicker as the core's replies arrive)
  toolbarKey = key;
  toolbar.style.maxWidth = `${available}px`;
  toolbar.style.left = `${centre}px`;
  const helpers = selectionHelpers();
  if (usable.length === 0 && helpers.length === 0) {
    const hint = document.createElement("span");
    hint.className = "none";
    hint.textContent = currentSels.length ? "No tools for this selection" : "Select a face or edge (Ctrl+K for commands)";
    const browse = document.createElement("button");
    browse.append(uiIcon("more"), "All tools");
    browse.className = "more";
    browse.title = "Open the tool drawer (T)";
    browse.addEventListener("click", () => toggleDrawer(true));
    toolbar.replaceChildren(hint, browse);
    return;
  }
  const rank = (t: ToolInfo) => (t.id === active ? -1 : GROUP_ORDER.includes(t.id) ? GROUP_ORDER.indexOf(t.id) : GROUP_ORDER.length);
  const ordered = [...usable].sort((a, b) => rank(a) - rank(b));
  const more = document.createElement("button");
  more.className = "more";
  more.title = "Open the tool drawer, showing the tools that work now (T)";
  more.addEventListener("click", () => toggleDrawer(true, true));
  const buttons = ordered.map((tool) => {
    const button = document.createElement("button");
    button.append(toolIcon(tool.id, tool.label), tool.label);
    button.title = toolTooltip(tool);
    button.className = tool.id === active ? "active" : "";
    button.addEventListener("click", () => armTool(tool, "strip"));
    return button;
  });
  const setMore = (hidden: number) => {
    more.replaceChildren(uiIcon("more"), hidden > 0 ? `${hidden} more` : "All tools");
  };
  // Measure pass: lay everything out, read the widths, then keep only the tools that fit in the available width.
  setMore(ordered.length);
  toolbar.replaceChildren(...buttons, ...helpers, more);
  const gap = parseFloat(getComputedStyle(toolbar).columnGap) || 6;
  const style = getComputedStyle(toolbar);
  const chrome = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 2;
  const widths = buttons.map((b) => b.getBoundingClientRect().width);
  const helperWidth = helpers.reduce((sum, h, i) => sum + h.getBoundingClientRect().width + (i ? gap : 0), 0);
  const count = fitStripCount({ tools: widths, helpers: helperWidth, more: more.getBoundingClientRect().width, gap, chrome }, available);
  for (const b of buttons.slice(count)) b.remove();
  setMore(ordered.length - count);
}

window.addEventListener("resize", () => renderToolbar());

/** Which selection helper buttons apply to the current selection (also the toolbar cache key). */
function helperSignature(): string {
  if (currentSels.length === 1 && currentSels[0].kind === "body") {
    const id = currentSels[0].id;
    return `body${id}${committed ? bodiesOf(committed).find((b) => b.id === id)?.editable : ""}`;
  }
  if (currentSels.length === 1) return `${currentSels[0].kind}${currentSels[0].id}`;
  if (currentSels.length > 1 && currentSels.every((s) => s.kind === "face")) return "faces" + currentSels.map((s) => s.id).join(",");
  return "";
}

/** Buttons that grow a selection of faces or an edge into a selection of edges. */
function selectionHelpers(): HTMLButtonElement[] {
  const make = (label: string, title: string, request: Record<string, unknown>, none = "Nothing more to select") => {
    const button = document.createElement("button");
    button.textContent = label;
    button.title = title;
    button.className = "helper";
    button.addEventListener("click", async () => {
      try {
        const reply = await core.request<{ edges?: number[]; loops?: number[][] }>("edge_selection", request);
        const ids = reply.edges ?? (reply.loops ?? []).flat();
        const picked: Sel[] = ids.map((id) => ({ kind: "edge" as const, id }));
        viewport.selectItems(picked);
        setSelection(picked);
        const same = picked.length === 1 && currentSels.length === 1 && "edge" in request;
        status.textContent = same ? `${label}: ${none}` : `${label}: ${picked.length} edge${picked.length === 1 ? "" : "s"} selected`;
      } catch (e) {
        status.textContent = (e as Error).message;
      }
    });
    return button;
  };
  const one = currentSels.length === 1 ? currentSels[0] : null;
  if (one?.kind === "body") {
    const body = committed ? bodiesOf(committed).find((b) => b.id === one.id) : undefined;
    if (!body?.editable) return [];
    const button = document.createElement("button");
    button.textContent = "Edit primitive";
    button.title = "Reopen the form and handles this body was made with";
    button.className = "helper";
    button.addEventListener("click", () => editPrimitive(one.id));
    return [button];
  }
  if (one?.kind === "face") {
    return [
      make("All edges", "Select every edge of the selected face, outline and holes", { mode: "face_edges", face: one.id }),
      make("Edge loops", "Select only the perimeter (outer) loop of the selected face, leaving out any holes", { mode: "face_outline", face: one.id }),
    ];
  }
  if (one?.kind === "edge") {
    return [
      make("Edge loops", "Select the closed outline of each face beside this edge (loops follow the shared faces, not an angle)", { mode: "edge_loops", edge: one.id }, "this edge has no outline beyond itself"),
      make("Edge ring", "Select the parallel edges across the faces on both sides of this edge, like the rungs of a ladder (needs four-sided faces)", { mode: "ring", edge: one.id }, "no ring: the faces beside it are not four-sided"),
      make("Sharp edges", `Select the connected edges where faces meet at ${settings.sharpAngle} degrees or more (change the angle in settings)`, { mode: "sharp", edge: one.id, angle: settings.sharpAngle }, "no connected sharp edges"),
    ];
  }
  if (currentSels.length > 1 && currentSels.every((s) => s.kind === "face")) {
    return [make("Region outline", "Select the edges around the outside of the selected faces", { mode: "region_boundary", faces: currentSels.map((s) => s.id) })];
  }
  return [];
}

/** Reopen the creation form and handles of an editable primitive body, filled with the values it was made with. */
function editPrimitive(id: number) {
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

function setSelection(sels: Sel[]) {
  if (toolPanel.isOpen) toolPanel.close(false); // the selection changed under an open tool form
  viewport.manipulator.clear();
  currentSels = sels;
  navCube.fitSelectedButton.disabled = sels.length === 0;
  bodyList.setSelected(sels.filter((s) => s.kind === "body").map((s) => s.id));
  refined = null;
  related = [];
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
    related = rulesReply.status === "fulfilled" ? rulesReply.value.rules : [];
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
        measuredDims = reply.dimensions ?? [];
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

/** Ids of the hidden bodies (view only). Ids are stable, so a hidden body stays hidden through operations. */
let hiddenBodies: ReadonlySet<number> = new Set();
/** Ids of the see-through bodies and the Focus toggle's memory (view only, like hiding). */
let ghostBodies: ReadonlySet<number> = new Set();
let focusState: FocusState | null = null;

/** Tells the list of kept sketches what the document holds; set once that list exists. */
let onSketches: (list: { id: number; name: string; rev: number }[]) => void = () => {};

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
  hiddenBodies = pruneHidden(hiddenBodies, bodiesOf(mesh).map((b) => b.id));
  const pruned = pruneGhost(ghostBodies, focusState, bodiesOf(mesh).map((b) => b.id));
  ghostBodies = pruned.ghost;
  focusState = pruned.focus;
  viewport.setMesh(filterHidden(mesh, hiddenBodies), frame);
  viewport.setGhosted(ghostBodies);
  if (!mesh.header.preview) {
    bodyList.setBodies(bodiesOf(mesh), hiddenBodies, ghostBodies, focusState?.body ?? null);
    onSketches(mesh.header.sketches ?? []);
  }
  undoButton.disabled = !mesh.header.canUndo;
  redoButton.disabled = !mesh.header.canRedo;
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
  show(mesh, frame);
  viewport.selectItems(sels);
  setSelection(sels);
  status.classList.remove("error");
  const warnings: string[] = mesh.header.warnings ?? [];
  if (mesh.header.solids !== undefined) showImportNotice(core, mesh.header.solids, warnings, (mesh.header.timings?.importMs ?? 0) + (mesh.header.timings?.meshMs ?? 0));
  status.textContent = `${mesh.header.name ?? select.value}: ${mesh.faces.length} faces` + (DEV ? `, ${mesh.indices.length / 3} triangles` : "") + (warnings.length ? ` | Warning: ${warnings.join("; ")}` : "");
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

function toolRequest(sels: Sel[], distance: number) {
  const tool = dragToolFor(sels)!;
  return { tool: tool.id, selection: selectionPayload(expand(tool, sels)), params: { [dragParam(tool)!]: distance } };
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
        mesh = await core.request<MeshData>("tool_commit", toolRequest(sels, distance));
      } catch (e) {
        // The final size can fail when the last preview reply was dropped at release;
        // fall back to the newest size known to work.
        if (good === null || good === distance) throw e;
        mesh = await core.request<MeshData>("tool_commit", toolRequest(sels, good));
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
  try {
    setCommitted(await core.request<MeshData>(kind));
  } catch (e) {
    status.textContent = (e as Error).message;
  }
}
$("info").addEventListener("click", async () => {
  try {
    measurePanel.show(await core.request<MeasureReply>("model_info"));
  } catch (e) {
    status.textContent = (e as Error).message;
  }
});
undoButton.addEventListener("click", () => history("undo"));
redoButton.addEventListener("click", () => history("redo"));
/** Redraw after the hidden set changed, dropping selected items that are no longer visible. */
function applyVisibility() {
  if (!committed) return;
  const keep = currentSels;
  show(committed);
  viewport.selectItems(keep.filter((s) => !hiddenBodies.has(ownerBody(s) ?? -1)));
  setSelection(currentSels.filter((s) => !hiddenBodies.has(ownerBody(s) ?? -1)));
}

/** The id of the body a selected item belongs to. */
function ownerBody(s: Sel): number | null {
  if (!committed) return null;
  if (s.kind === "body") return s.id;
  return (s.kind === "face" ? committed.faces : s.kind === "edge" ? committed.edges : committed.vertices).find((x) => x.id === s.id)?.body ?? null;
}

/** H hides the body of the selection, Shift+H isolates it, Alt+H shows everything. */
function setVisibility(action: "hide" | "isolate" | "show") {
  if (!committed) return;
  const all = bodiesOf(committed).map((b) => b.id);
  const picked = new Set(currentSels.map(ownerBody).filter((id): id is number => id !== null));
  if (action === "show") hiddenBodies = new Set();
  else if (picked.size) {
    hiddenBodies = action === "isolate" ? new Set(all.filter((id) => !picked.has(id))) : new Set([...hiddenBodies, ...picked]);
  }
  applyVisibility();
}

const bodyList = new BodyList($("bodylist"), {
  toggleHide(id) {
    hiddenBodies = toggleHidden(hiddenBodies, id);
    applyVisibility();
  },
  toggleIsolate(id) {
    if (!committed) return;
    hiddenBodies = toggleIsolated(hiddenBodies, bodiesOf(committed).map((b) => b.id), id);
    applyVisibility();
  },
  toggleGhost(id) {
    ghostBodies = toggleGhost(ghostBodies, id);
    if (focusState) focusState = { ...focusState, added: new Set([...focusState.added].filter((b) => ghostBodies.has(b))) };
    applyVisibility();
  },
  toggleFocus(id) {
    if (!committed) return;
    const next = toggleFocus(ghostBodies, focusState, bodiesOf(committed).map((b) => b.id), id);
    ghostBodies = next.ghost;
    focusState = next.focus;
    applyVisibility();
  },
  rename(id, name) {
    core
      .request<MeshData>("rename_body", { body: id, name })
      .then((mesh) => setCommitted(mesh, false, currentSels))
      .catch((e) => {
        status.textContent = (e as Error).message;
        status.classList.add("error");
        if (committed) bodyList.setBodies(bodiesOf(committed), hiddenBodies, ghostBodies, focusState?.body ?? null);
      });
  },
  select(ids) {
    const picked: Sel[] = ids.map((id) => ({ kind: "body" as const, id }));
    viewport.selectItems(picked);
    setSelection(picked);
  },
  hover(id) {
    viewport.hoverItem(id === null ? null : { kind: "body", id });
  },
  edit(id) {
    editPrimitive(id);
  },
}, $("bodycount"));
bodyList.setBodies([], new Set()); // the list is always shown; before a model exists it says so

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
    ...Object.fromEntries(["sketch.undo", "sketch.cancel", "sketch.finish", "sketch.delete"].map((id) => [id, (e: KeyboardEvent) => sketch.onKey(e)])),
  },
  entryActive: () => viewport.dragging || dragSels !== null || viewport.manipulator.dragging,
  sketchActive: () => sketch.active,
  cancelInteraction: () => {
    viewport.cancelDrag();
    viewport.manipulator.cancel();
  },
  status,
  hints: { get: () => hintLine.prefs.on, set: (on) => hintLine.setOn(on) },
});
syncSeeThrough();
setKeysOpener(() => keys.openSettings());
setHintsBinding({ get: () => hintLine.prefs.on, set: (on) => hintLine.setOn(on) });
// Leaving with edits (undo steps) or an open sketch asks first; autosave still protects against crashes.
window.addEventListener("beforeunload", (e) => {
  if (!undoButton.disabled || sketch.active) e.preventDefault();
});

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Import adds the file as a body and keeps the session; "Open as new model" starts again from the file.
let importAsNew = false;
$("open").addEventListener("click", () => {
  importAsNew = false;
  fileInput.click();
});
$("openasnew").addEventListener("click", () => {
  importAsNew = true;
  fileInput.click();
});
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;
  const mode = importAsNew ? "replace" : "add";
  if (mode === "replace" && !undoButton.disabled && !window.confirm("Opening a file as a new model replaces the current model and its undo history. Continue? (Use Import STEP to add the file to the current model instead.)")) return;
  try {
    status.textContent = `importing ${file.name}...`;
    const data = toBase64(new Uint8Array(await file.arrayBuffer()));
    if (mode === "replace") setCommitted(await core.request<MeshData>("import_step", { name: file.name, data }), true);
    else setCommitted(await core.request<MeshData>("combine_step", { data, mode }), false);
  } catch (e) {
    status.textContent = (e as Error).message;
    status.classList.add("error");
  }
});

/** Ask the core for the model in a file format and save it through the browser. */
async function exportAs(request: string, extension: string, params: Record<string, unknown> = {}) {
  type Picker = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }>;
  try {
    // Where the browser has a save dialog, ask for the name and place before building the file; otherwise download.
    const pick = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;
    let handle: Awaited<ReturnType<Picker>> | null = null;
    if (pick) {
      try {
        handle = await pick({ suggestedName: `${select.value || "model"}.${extension}`, types: [{ description: extension.toUpperCase() + " file", accept: { "application/octet-stream": ["." + extension] } }] });
      } catch (e) {
        if ((e as Error).name === "AbortError") return; // cancelled in the dialog
      }
    }
    const { name, data } = await core.request<{ name: string; data: string }>(request, params);
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    if (handle) {
      const out = await handle.createWritable();
      await out.write(blob);
      await out.close();
      return;
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name.replace(/\.(step|stp|stl|obj|3mf)$/i, "") + "." + extension;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (e) {
    status.textContent = (e as Error).message;
  }
}

$("export").addEventListener("click", () => exportAs("export_step", "step"));
const exportMesh = $("exportmesh") as HTMLSelectElement;
exportMesh.addEventListener("change", () => {
  const format = exportMesh.value;
  exportMesh.value = "";
  if (format) void exportAs("export_mesh", format, { format });
});

let loadedSample = select.value;
select.addEventListener("change", () => {
  if (!undoButton.disabled && !window.confirm("Opening a sample model replaces the current model and its undo history. Continue?")) {
    select.value = loadedSample;
    return;
  }
  loadedSample = select.value;
  load(select.value).catch((e) => (status.textContent = e.message));
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
  const demos: Command[] = [...select.options].map((option) => ({
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
    { label: "Show all bodies", scope: "body", hint: keys.keymap.hint("display.showAll"), enabled: hiddenBodies.size > 0, run: () => setVisibility("show") },
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
    { label: "Open STEP file as new model", scope: "file", enabled: true, run: () => $("openasnew").click() },
    { label: "Export STEP file", scope: "file", enabled: true, run: () => exportAs("export_step", "step") },
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
      status.classList.toggle("error", error);
    },
    showPreview: (mesh) => show(mesh),
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
sketch.onToolChange = () => renderToolbar();
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
  rename: (id, name) => keptRequest("sketch_rename", { sketch_id: id, name }),
  extrude(id, params, commit) {
    core
      .request<MeshData>("sketch_extrude", { sketch_id: id, ...params, commit })
      .then((mesh) => {
        if (commit) setCommitted(mesh, false, currentSels);
        else {
          show(mesh);
          status.textContent = "Extrude preview";
          status.classList.remove("error");
        }
      })
      .catch((e) => {
        status.textContent = (e as Error).message;
        status.classList.add("error");
        if (!commit && committed) show(committed);
      });
  },
});
onSketches = (list) => keptSketches.setList(list);
viewport.profileTargets = () => (sketch.active ? [] : keptSketches.fillTargets());
viewport.onProfileClick = (id) => keptSketches.startExtrude(id);
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
viewport.manipulator.onDrag = (param, value, phase, x, y, linked) => {
  lastDragEvent = performance.now();
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
  await load(select.value);
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

/** In-page prompt (not a browser dialog, which would block the page) offered when the core was killed last time. */
let dismissRestorePrompt: (() => void) | null = null;
function askRestore(info: { name: string; steps: number; saved?: number }): Promise<boolean> {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    // A dropped connection closes the prompt, so the reconnect is not left waiting on an answer nobody can use.
    dismissRestorePrompt = () => {
      box.remove();
      dismissRestorePrompt = null;
      resolve(false);
    };
    box.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);z-index:100";
    const card = document.createElement("div");
    card.style.cssText = "background:#2b2b2b;color:#eee;padding:20px 24px;border-radius:8px;max-width:360px;font:14px sans-serif";
    const text = document.createElement("p");
    const when = info.saved ? `, saved ${new Date(info.saved * 1000).toLocaleString()}` : "";
    text.textContent = `Pliable did not close cleanly last time. Restore your last session? "${info.name}", with ${info.steps - 1} undo steps${when}.`;
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
    for (const [label, answer] of [["Start fresh", false], ["Restore", true]] as const) {
      const button = document.createElement("button");
      button.textContent = label;
      button.title = answer ? "Reopen the model and undo steps from the last session" : "Discard the last session and start empty";
      button.onclick = () => {
        box.remove();
        dismissRestorePrompt = null;
        resolve(answer);
      };
      row.append(button);
    }
    card.append(text, row);
    box.append(card);
    document.body.append(box);
  });
}

core.onDisconnect = () => {
  dismissRestorePrompt?.();
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
