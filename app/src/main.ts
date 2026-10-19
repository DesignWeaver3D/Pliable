import * as THREE from "three";
import { PointPicker, ReferenceView } from "./reference";
import { installAlphaUi, showImportNotice, showLaunchNotice } from "./alpha";
import { CoreClient, type MeshData } from "./client";
import { SketchMode } from "./sketch";
import { SKETCH_PLANES } from "./layout";
import { ToolPanel, type ParamValue } from "./toolpanel";
import { NavCube, VIEW_KEYS } from "./navcube";
import { DimensionOverlay } from "./dimensions";
import { createSettingsWindow, settings } from "./settings";
import { MeasurePanel, type MeasureReply } from "./measure";
import { KeyRouter } from "./keyrouter";
import { HintLine } from "./hints";
import { Palette, type Command } from "./palette";
import { acceptsSelection, describeNeeds, dragParam, toolTooltip, type ToolInfo } from "./tools";
import { Viewport, type Sel } from "./viewport";
import { usage, type Surface } from "./usage";
import { filterHidden, solidsOf } from "./visibility";

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
$("axes").addEventListener("click", () => reference.setVisible(!reference.visible));
viewport.onFrame = () => {
  reference.tick();
  dimensionOverlay.draw();
  navCube.update();
};

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
// else the tool's own default, else the base default. A hole moves alone unless the user adds its twins.
const BASE_RULES: Record<string, boolean> = { coplanar: true, equal_radius: false, coaxial: false };
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
  chips.replaceChildren(
    ...shown.map((rule) => {
      const b = document.createElement("button");
      const n = rule.faces.length;
      const what = `${rule.label.toLowerCase()} face${n === 1 ? "" : "s"}`;
      b.textContent = `${ruleOn(rule.id) ? "✔ With" : "+ Add"} ${n} ${what}`;
      b.className = ruleOn(rule.id) ? "on" : "";
      b.title = ruleOn(rule.id) ? `Tools change the selected face and the ${n} ${what} together; click to change only the selected face` : `Tools change only the selected face; click to include the ${n} ${what} too`;
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

const toolbar = $("tools");

let toolbarKey = "";

function renderToolbar() {
  renderChips();
  const usable = usableTools();
  const active = dragToolFor(currentSels)?.id;
  const helperKey = helperSignature();
  const key = `${usable.map((t) => t.id).join(",")}|${active}|${currentSels.length}|${helperKey}`;
  if (key === toolbarKey) return; // unchanged: keep the buttons (avoids flicker as the core's replies arrive)
  toolbarKey = key;
  const helpers = selectionHelpers();
  if (usable.length === 0 && helpers.length === 0) {
    const hint = document.createElement("span");
    hint.className = "none";
    hint.textContent = currentSels.length ? "No tools for this selection" : "Select a face or edge (Ctrl+K for commands)";
    toolbar.replaceChildren(hint);
    return;
  }
  toolbar.replaceChildren(
    ...usable.map((tool) => {
      const button = document.createElement("button");
      button.textContent = tool.label;
      button.title = toolTooltip(tool);
      button.className = tool.id === active ? "active" : "";
      button.addEventListener("click", () => armTool(tool, "strip"));
      return button;
    }),
    ...helpers,
  );
}

/** Which selection helper buttons apply to the current selection (also the toolbar cache key). */
function helperSignature(): string {
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
  if (one?.kind === "face") {
    return [
      make("All edges", "Select every edge of the selected face, outline and holes", { mode: "face_edges", face: one.id }),
      make("Edge loops", "Select the closed edge loops that bound the selected face (outline and holes)", { mode: "face_loops", face: one.id }),
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

function armTool(tool: ToolInfo, surface: Surface) {
  if (dragParam(tool) === null) {
    toolPanel.openForm(tool, {}, surface);
    return;
  }
  usage.record(tool.id, "start", surface);
  armedTool = tool.id;
  renderToolbar();
  if (!status.classList.contains("error")) status.textContent = `${tool.label}: drag the selection`;
}

function setSelection(sels: Sel[]) {
  if (toolPanel.isOpen) toolPanel.close(false); // the selection changed under an open tool form
  currentSels = sels;
  refined = null;
  related = [];
  selected.textContent = describe(sels);
  if (sels.length === 0) {
    measurePanel.hide();
    dimensionOverlay.set([]);
    renderChips();
    renderToolbar();
    toolPanel.renderList();
    renderSketchBar();
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
    renderChips();
    renderToolbar();
    toolPanel.renderList();
    renderSketchBar();
  });
  core
    .request<MeasureReply>("measure", { selection: selectionPayload(sels) })
    .then((reply) => {
      if (currentSels === sels && dragSels === null) {
        measurePanel.show(reply);
        dimensionOverlay.set(reply.dimensions ?? []);
      }
    })
    .catch(() => {
      if (currentSels === sels) {
        measurePanel.hide();
        dimensionOverlay.set([]);
      }
    });
}

function selectionPayload(sels: Sel[]) {
  const ids = (kind: Sel["kind"]) => sels.filter((s) => s.kind === kind).map((s) => s.id);
  return { faces: ids("face"), edges: ids("edge"), vertices: ids("vertex") };
}

let committed: MeshData | null = null; // last committed (non-preview) mesh
/** The newest committed tool run, kept while nothing else has changed the model: "Edit last" undoes it and reopens its form. */
let lastOp: { tool: ToolInfo; sels: Sel[]; values: Record<string, ParamValue> } | null = null;

const hiddenSolids = new Set<number>();

function show(mesh: MeshData, frame = false) {
  const present = new Set(solidsOf(mesh));
  for (const n of hiddenSolids) if (!present.has(n)) hiddenSolids.delete(n);
  viewport.setMesh(filterHidden(mesh, hiddenSolids), frame);
  undoButton.disabled = !mesh.header.canUndo;
  redoButton.disabled = !mesh.header.canRedo;
}

function describe(sels: Sel[]): string {
  if (sels.length === 0) return "";
  return sels.length === 1 ? `${sels[0].kind} ${sels[0].id}` : `${sels.length} ${sels[0].kind}s`;
}

/** The selection a reply says the old selection maps to. */
function mappedSelection(mesh: MeshData): Sel[] {
  const s = mesh.header.selection ?? {};
  const result: Sel[] = [];
  for (const [key, kind] of [["faces", "face"], ["edges", "edge"], ["vertices", "vertex"]] as const) {
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

// Moving a hole by dragging its centre dot: previews the Move hole tool (latest request wins) and commits on release.
let centreBusy = false;
let centreQueued: { face: number; offset: { x: number; y: number; z: number } } | null = null;
function centreRequest(face: number, o: { x: number; y: number; z: number }) {
  const tool = tools.find((t) => t.id === "move_hole");
  if (!tool) return null;
  return { tool: tool.id, selection: selectionPayload(expand(tool, [{ kind: "face", id: face }])), params: { dx: o.x, dy: o.y, dz: o.z } };
}
async function pumpCentre() {
  if (centreBusy || !centreQueued) return;
  const { face, offset } = centreQueued;
  centreQueued = null;
  const req = centreRequest(face, offset);
  if (!req) return;
  centreBusy = true;
  try {
    show(await core.request<MeshData>("tool_preview", req));
    status.classList.remove("error");
    status.textContent = `Move hole: ${offset.x.toFixed(2)}, ${offset.y.toFixed(2)}, ${offset.z.toFixed(2)}`;
  } catch (e) {
    status.textContent = (e as Error).message;
    status.classList.add("error");
  } finally {
    centreBusy = false;
    void pumpCentre();
  }
}
viewport.onCentreDrag = async (face, offset, phase) => {
  if (phase === "move") {
    centreQueued = { face, offset: { x: offset.x, y: offset.y, z: offset.z } };
    void pumpCentre();
    return;
  }
  centreQueued = null;
  while (centreBusy) await new Promise((r) => setTimeout(r, 20));
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
viewport.onEdgeLoop = async (edgeId, additive) => {
  try {
    // Another edge is already selected: take the loop of the face the two share.
    const other = currentSels.find((s) => s.kind === "edge" && s.id !== edgeId);
    if (other) {
      try {
        const { edges } = await core.request<{ edges: number[] }>("edge_selection", { mode: "shared_loop", first: other.id, second: edgeId });
        const picked: Sel[] = edges.map((id) => ({ kind: "edge" as const, id }));
        viewport.selectItems(picked);
        setSelection(picked);
        status.textContent = `${picked.length} edge${picked.length === 1 ? "" : "s"} in the loop the two edges share`;
        return;
      } catch {
        // no common face: fall back to the smooth chain below
      }
    }
    // Otherwise the outline of the faces beside the edge (shared faces decide, not the angle); an edge with no
    // outline beyond itself falls back to the smooth chain.
    let { edges } = await core.request<{ edges: number[] }>("edge_selection", { mode: "edge_loops", edge: edgeId });
    if (edges.length <= 1) edges = (await core.request<{ edges: number[] }>("edge_chain", { edge: edgeId })).edges;
    const picked: Sel[] = edges.map((id) => ({ kind: "edge" as const, id }));
    const sels = additive ? [...currentSels.filter((s) => s.kind === "edge" && !edges.includes(s.id)), ...picked] : picked;
    viewport.selectItems(sels);
    setSelection(sels);
    status.textContent = `${picked.length} edge${picked.length === 1 ? "" : "s"} selected by double-click (the outline of the faces beside the edge)`;
  } catch (e) {
    status.textContent = (e as Error).message;
  }
};

// Dimension label: follows the pointer during a drag; typing digits turns it into the value entry.
const dimLabel = $("dim");
const DIM_OFFSET_PX = 16; // label offset from the pointer
// The core has no unit system: STEP import converts to millimetres, so lengths are mm. A unit setting replaces this later.
const LENGTH_UNIT = "mm";
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
    // First Escape leaves value entry and goes back to the mouse drag; the next one cancels it.
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
    dimensionOverlay.set([]);
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
  await inFlight;
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
/** H hides the solid of the selection, Shift+H isolates it, Alt+H shows everything. */
function setVisibility(action: "hide" | "isolate" | "show") {
  if (!committed) return;
  const owner = (s: Sel) => (s.kind === "face" ? committed!.faces : s.kind === "edge" ? committed!.edges : committed!.vertices).find((x) => x.id === s.id)?.solid ?? 0;
  const picked = new Set(currentSels.map(owner));
  if (action === "show") hiddenSolids.clear();
  else if (picked.size) {
    const all = solidsOf(committed);
    for (const n of all) if (action === "isolate" ? !picked.has(n) : picked.has(n)) hiddenSolids.add(n);
    if (action === "isolate") for (const n of picked) hiddenSolids.delete(n);
  }
  const keep = currentSels;
  show(committed);
  viewport.selectItems(keep.filter((s) => !hiddenSolids.has(owner(s))));
  setSelection(currentSels.filter((s) => !hiddenSolids.has(owner(s))));
}

// Keyboard shortcuts: one router applies the policy in keys.ts (engagement, blur, repeat, entry, sketch) and runs these.
const keys = new KeyRouter({
  viewport: $("viewport"),
  handlers: {
    ...Object.fromEntries(Object.entries(VIEW_KEYS).map(([, name]) => [`view.${name}`, () => viewport.setView(name)])),
    "view.projection": () => navCube.toggleProjection(),
    "display.seeThrough": () => viewport.toggleSeeThrough(),
    "view.lookAtFace": () => {
      if (currentSels.length === 1 && currentSels[0].kind === "face" && !viewport.alignToFace(currentSels[0].id)) status.textContent = "Look at face: could not find a view direction for this face";
    },
    "display.hide": () => setVisibility("hide"),
    "display.isolate": () => setVisibility("isolate"),
    "display.showAll": () => setVisibility("show"),
    "history.undo": () => void history("undo"),
    "history.redo": () => void history("redo"),
    ...Object.fromEntries(["sketch.undo", "sketch.cancel", "sketch.finish", "sketch.delete"].map((id) => [id, (e: KeyboardEvent) => sketch.onKey(e)])),
  },
  entryActive: () => viewport.dragging || dragSels !== null,
  sketchActive: () => sketch.active,
  cancelInteraction: () => viewport.cancelDrag(),
  status,
  hints: { get: () => hintLine.prefs.on, set: (on) => hintLine.setOn(on) },
});
keys.installButton($("bar"));
// Leaving with edits (undo steps) or an open sketch asks first; autosave still protects against crashes.
window.addEventListener("beforeunload", (e) => {
  if (!undoButton.disabled || sketch.active) e.preventDefault();
});

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

$("open").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;
  try {
    status.textContent = `importing ${file.name}...`;
    const data = toBase64(new Uint8Array(await file.arrayBuffer()));
    setCommitted(await core.request<MeshData>("import_step", { name: file.name, data }), true);
  } catch (e) {
    status.textContent = (e as Error).message;
  }
});

const combineFile = $("combinefile") as HTMLInputElement;
$("combine").addEventListener("click", () => combineFile.click());
combineFile.addEventListener("change", async () => {
  const file = combineFile.files?.[0];
  combineFile.value = "";
  if (!file) return;
  try {
    status.textContent = `combining ${file.name}...`;
    const data = toBase64(new Uint8Array(await file.arrayBuffer()));
    const mode = ($("combinemode") as HTMLSelectElement).value;
    setCommitted(await core.request<MeshData>("combine_step", { data, mode }), false);
  } catch (e) {
    status.textContent = (e as Error).message;
    status.classList.add("error");
  }
});

/** Ask the core for the model in a file format and save it through the browser. */
async function exportAs(request: string, extension: string, params: Record<string, unknown> = {}) {
  try {
    const { name, data } = await core.request<{ name: string; data: string }>(request, params);
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    link.download = name.replace(/\.(step|stp|stl|obj|3mf)$/i, "") + "." + extension;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (e) {
    status.textContent = (e as Error).message;
  }
}

$("export").addEventListener("click", () => exportAs("export_step", "step"));

select.addEventListener("change", () => load(select.value).catch((e) => (status.textContent = e.message)));

function commands(): Command[] {
  const usable = new Set(usableTools().map((t) => t.id));
  const toolCommands: Command[] = tools.map((tool) => ({
    label: tool.label,
    title: toolTooltip(tool),
    hint: usable.has(tool.id) ? "drag the selection" : `select ${describeNeeds(tool)}`,
    enabled: usable.has(tool.id),
    run: () => armTool(tool, "search"),
  }));
  const demos: Command[] = [...select.options].map((option) => ({
    label: `Open demo: ${option.value}`,
    enabled: true,
    run: () => {
      select.value = option.value;
      load(option.value).catch((e) => (status.textContent = e.message));
    },
  }));
  return [
    ...toolCommands,
    { label: "Undo", hint: keys.keymap.hint("history.undo"), enabled: !undoButton.disabled, run: () => history("undo") },
    { label: "Redo", hint: keys.keymap.hint("history.redo"), enabled: !redoButton.disabled, run: () => history("redo") },
    { label: "Hide body", hint: keys.keymap.hint("display.hide"), enabled: currentSels.length > 0, run: () => setVisibility("hide") },
    { label: "Isolate body", hint: keys.keymap.hint("display.isolate"), enabled: currentSels.length > 0, run: () => setVisibility("isolate") },
    { label: "Show all bodies", hint: keys.keymap.hint("display.showAll"), enabled: hiddenSolids.size > 0, run: () => setVisibility("show") },
    { label: "See-through selection (pick edges and faces behind the model)", hint: keys.keymap.hint("display.seeThrough"), enabled: true, run: () => viewport.toggleSeeThrough() },
    {
      label: "Measure pick (hidden mode: press M while dragging a tool)",
      hint: "M while dragging",
      title: "Start dragging a tool, then press M to measure distances to other geometry. It cannot start from this list.",
      enabled: true,
      run: () => (status.textContent = "Measure pick: start dragging a tool, then press M to pick geometry to measure against"),
    },
    { label: hintLine.prefs.on ? "Turn hints off" : "Turn hints on", enabled: true, run: () => hintLine.setOn(!hintLine.prefs.on) },
    { label: "Open STEP file", enabled: true, run: () => fileInput.click() },
    { label: "Export STEP file", enabled: true, run: () => exportAs("export_step", "step") },
    ...["stl", "obj", "3mf"].map((format) => ({
      label: `Export ${format.toUpperCase()} mesh (lossy)`,
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
const hintLine = new HintLine(
  $("viewport"),
  () => ({ dragging: viewport.dragging || dragSels !== null, sketch: sketch.active, hasSelection: currentSels.length > 0 }),
  (id) => keys.keymap.hint(id),
);
const sketchBar = $("sketchbar");
let planeOffset = 0; // distance of the next standard-plane sketch from the plane, along its normal
let sketchBarKey = "";
function renderSketchBar() {
  const face = currentSels.length === 1 && currentSels[0].kind === "face" ? committed?.faces.find((f) => f.id === currentSels[0].id) : undefined;
  const faceSels = currentSels.filter((s) => s.kind === "face");
  const key = `${!!face}|${!!face?.normal}|${faceSels.length}|${sketch.active}`;
  if (key === sketchBarKey) return; // the bar only depends on these two flags; keep the buttons otherwise
  sketchBarKey = key;
  const onFace = document.createElement("button");
  onFace.textContent = "Sketch on selected face";
  onFace.disabled = !face?.normal || sketch.active;
  onFace.title = "Start a 2D sketch drawn on the selected flat face. Select one flat face first.";
  onFace.addEventListener("click", async () => {
    try {
      const reply = await core.request<{ plane: any; reference?: any }>("sketch_plane", { face: currentSels[0].id });
      sketch.start(reply.plane, reply.reference);
      renderSketchBar();
    } catch (e) {
      status.textContent = (e as Error).message;
    }
  });
  const unroll = document.createElement("button");
  unroll.textContent = "Sketch on unrolled faces";
  unroll.disabled = !(faceSels.length > 1 || (faceSels.length === 1 && !committed?.faces.find((f) => f.id === faceSels[0].id)?.normal)) || sketch.active;
  unroll.title = "Select a cone or cylinder face, or a chain of flat and rounded faces joined along parallel edges: they are unrolled flat, you sketch on them, and the regions are wrapped back";
  unroll.addEventListener("click", async () => {
    try {
      const ids = faceSels.map((f) => f.id);
      const reply = await core.request<{ plane: any; reference?: any }>("sketch_plane", { unwrap: ids });
      sketch.start(reply.plane, reply.reference, ids);
      renderSketchBar();
    } catch (e) {
      status.textContent = (e as Error).message;
    }
  });
  const label = document.createElement("span");
  label.textContent = "or on";
  const offset = document.createElement("input");
  offset.type = "number";
  offset.step = "any";
  offset.value = String(planeOffset);
  offset.title = "Offset of the sketch plane from XY, XZ or YZ along its normal";
  offset.style.width = "56px";
  offset.addEventListener("keydown", (e) => e.stopPropagation());
  offset.addEventListener("input", () => (planeOffset = Number(offset.value) || 0));
  sketchBar.replaceChildren(
    onFace,
    unroll,
    label,
    ...SKETCH_PLANES.map((name) => {
      const b = document.createElement("button");
      b.textContent = name;
      b.title = `Start a 2D sketch on the ${name} plane through the origin (the offset box moves the plane)`;
      b.disabled = sketch.active;
      b.addEventListener("click", async () => {
        const reply = await core.request<{ plane: any }>("sketch_plane", { plane: name, offset: planeOffset });
        sketch.start(reply.plane);
        renderSketchBar();
      });
      return b;
    }),
    offset,
  );
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

const toolPanel = new ToolPanel($("toollist"), $("toolform"), {
  selectedEdges: () => currentSels.filter((s) => s.kind === "edge").map((s) => s.id),
  pickPoint: () => pointPicker.pick(),
  tools: () => tools,
  usable: (tool) => acceptsSelection(tool, expand(tool, currentSels)) && (refined === null || refined.includes(tool.id)),
  async preview(tool, values) {
    try {
      const mesh = await core.request<MeshData>("tool_preview", { tool: tool.id, selection: selectionPayload(expand(tool, currentSels)), params: values });
      if (!toolPanel.isOpen) return;
      show(mesh);
      status.classList.remove("error");
      status.textContent = `${tool.label}: preview`;
    } catch (e) {
      status.textContent = (e as Error).message;
      status.classList.add("error");
    }
  },
  async commit(tool, values) {
    const sels = currentSels;
    try {
      const mesh = await core.request<MeshData>("tool_commit", { tool: tool.id, selection: selectionPayload(expand(tool, sels)), params: values });
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

new Palette(commands);
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
  tools = (await core.request<{ tools: ToolInfo[] }>("list_tools")).tools;
  renderToolbar();
  toolPanel.renderList();
  const { restore } = await core.request<{ restore?: { name: string; steps: number } }>("hello");
  if (hadModel) {
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
function askRestore(info: { name: string; steps: number }): Promise<boolean> {
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
    text.textContent = `Pliable did not close cleanly last time. Restore your last session? "${info.name}", with ${info.steps - 1} undo steps.`;
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
