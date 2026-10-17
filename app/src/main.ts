import { CoreClient, type MeshData } from "./client";
import { SketchMode } from "./sketch";
import { SKETCH_PLANES } from "./layout";
import { ToolPanel } from "./toolpanel";
import { NavCube, VIEW_KEYS } from "./navcube";
import { DimensionOverlay } from "./dimensions";
import { MeasurePanel, type MeasureReply } from "./measure";
import { Palette, type Command } from "./palette";
import { acceptsSelection, describeNeeds, dragParam, type ToolInfo } from "./tools";
import { Viewport, type Sel } from "./viewport";

const $ = (id: string) => document.getElementById(id)!;
const status = $("status");
const selected = $("selected");
const latency = $("latency");
const undoButton = $("undo") as HTMLButtonElement;
const redoButton = $("redo") as HTMLButtonElement;
const fileInput = $("file") as HTMLInputElement;
const select = $("demo") as HTMLSelectElement;
const viewport = new Viewport($("viewport"));
const core = new CoreClient();
const measurePanel = new MeasurePanel($("measure"));
const dimensionOverlay = new DimensionOverlay($("viewport"), viewport.camera);
const navCube = new NavCube($("navcube"), viewport);
viewport.onFrame = () => {
  dimensionOverlay.draw();
  navCube.update();
};

// View shortcuts (standard numbering): 0 isometric, 1 front, 2 top, 3 right, 4 rear, 5 bottom, 6 left;
// P toggles perspective/orthographic; V looks straight at the selected planar face. Ignored while typing or dragging.
window.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement;
  if (e.ctrlKey || e.metaKey || e.altKey || target.closest("input, textarea, select") || viewport.dragging || dragSels !== null) return;
  if (e.key in VIEW_KEYS) viewport.setView(VIEW_KEYS[e.key]);
  else if (e.key === "p" || e.key === "P") navCube.toggleProjection();
  else if ((e.key === "v" || e.key === "V") && currentSels.length === 1 && currentSels[0].kind === "face") {
    if (!viewport.alignToFace(currentSels[0].id)) status.textContent = "Look at face: the face must be flat";
  }
});

// Tool registry from the core, the current selection, and which tool a drag runs.
let tools: ToolInfo[] = [];
let currentSels: Sel[] = [];
let refined: string[] | null = null; // ids the core says apply to currentSels (null until it replies)
let armedTool: string | null = null; // tool the user chose in the toolbar or palette

/** Tools usable with the current selection: counts checked here, the core's extra checks once it replies. */
function usableTools(): ToolInfo[] {
  return tools.filter((t) => acceptsSelection(t, currentSels) && (refined === null || refined.includes(t.id)));
}

/** The tool a drag on `sels` runs: the armed one if it applies, else the first with a drag parameter. */
function dragToolFor(sels: Sel[]): ToolInfo | null {
  const candidates = tools.filter((t) => dragParam(t) !== null && acceptsSelection(t, sels));
  return candidates.find((t) => t.id === armedTool) ?? candidates[0] ?? null;
}

const toolbar = $("tools");

function renderToolbar() {
  const usable = usableTools();
  const active = dragToolFor(currentSels)?.id;
  if (usable.length === 0) {
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
      button.title = `${tool.label}: drag the selection`;
      button.className = tool.id === active ? "active" : "";
      button.addEventListener("click", () => armTool(tool));
      return button;
    }),
  );
}

function armTool(tool: ToolInfo) {
  if (dragParam(tool) === null) {
    toolPanel.openForm(tool);
    return;
  }
  armedTool = tool.id;
  renderToolbar();
  if (!status.classList.contains("error")) status.textContent = `${tool.label}: drag the selection`;
}

function setSelection(sels: Sel[]) {
  if (toolPanel.isOpen) toolPanel.close(false); // the selection changed under an open tool form
  currentSels = sels;
  refined = null;
  selected.textContent = describe(sels);
  renderToolbar();
  toolPanel.renderList();
  renderSketchBar();
  measurePanel.hide();
  dimensionOverlay.set([]);
  if (sels.length === 0) return;
  core
    .request<MeasureReply>("measure", { selection: selectionPayload(sels) })
    .then((reply) => {
      if (currentSels === sels && dragSels === null) {
        measurePanel.show(reply);
        dimensionOverlay.set(reply.dimensions ?? []);
      }
    })
    .catch(() => {});
  core
    .request<{ tools: string[] }>("available_tools", { selection: selectionPayload(sels) })
    .then((reply) => {
      if (currentSels !== sels) return; // the selection changed while waiting
      refined = reply.tools;
      renderToolbar();
      toolPanel.renderList();
    })
    .catch(() => {});
}

function selectionPayload(sels: Sel[]) {
  const ids = (kind: Sel["kind"]) => sels.filter((s) => s.kind === kind).map((s) => s.id);
  return { faces: ids("face"), edges: ids("edge"), vertices: ids("vertex") };
}

let committed: MeshData | null = null; // last committed (non-preview) mesh

function show(mesh: MeshData, frame = false) {
  viewport.setMesh(mesh, frame);
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
  show(mesh, frame);
  viewport.selectItems(sels);
  setSelection(sels);
  status.classList.remove("error");
  status.textContent = `${mesh.header.name ?? select.value}: ${mesh.faces.length} faces, ${mesh.indices.length / 3} triangles`;
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
  return { tool: tool.id, selection: selectionPayload(sels), params: { [dragParam(tool)!]: distance } };
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
  try {
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
      latency.textContent = `commit ${Math.round(performance.now() - start)} ms`;
    } else if (committed) {
      setCommitted(committed, false, sels);
    }
  } catch (e) {
    if (committed) setCommitted(committed, false, sels);
    status.textContent = (e as Error).message; // after setCommitted, which rewrites the status
    status.classList.add("error");
  }
};

async function history(kind: "undo" | "redo") {
  try {
    setCommitted(await core.request<MeshData>(kind));
  } catch (e) {
    status.textContent = (e as Error).message;
  }
}
undoButton.addEventListener("click", () => history("undo"));
redoButton.addEventListener("click", () => history("redo"));
window.addEventListener("keydown", (e) => {
  if (!e.ctrlKey || sketch.active) return; // in sketch mode Ctrl+Z undoes sketch edits
  if (e.key === "z") history("undo");
  else if (e.key === "y") history("redo");
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

$("export").addEventListener("click", async () => {
  try {
    const { name, data } = await core.request<{ name: string; data: string }>("export_step");
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([bytes], { type: "application/step" }));
    link.download = name.replace(/\.(step|stp)$/i, "") + ".step";
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (e) {
    status.textContent = (e as Error).message;
  }
});

select.addEventListener("change", () => load(select.value).catch((e) => (status.textContent = e.message)));

function commands(): Command[] {
  const usable = new Set(usableTools().map((t) => t.id));
  const toolCommands: Command[] = tools.map((tool) => ({
    label: tool.label,
    hint: usable.has(tool.id) ? "drag the selection" : `select ${describeNeeds(tool)}`,
    enabled: usable.has(tool.id),
    run: () => armTool(tool),
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
    { label: "Undo", hint: "Ctrl+Z", enabled: !undoButton.disabled, run: () => history("undo") },
    { label: "Redo", hint: "Ctrl+Y", enabled: !redoButton.disabled, run: () => history("redo") },
    { label: "Open STEP file", enabled: true, run: () => fileInput.click() },
    { label: "Export STEP file", enabled: true, run: () => $("export").click() },
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
const sketchBar = $("sketchbar");
function renderSketchBar() {
  const face = currentSels.length === 1 && currentSels[0].kind === "face" ? committed?.faces.find((f) => f.id === currentSels[0].id) : undefined;
  const onFace = document.createElement("button");
  onFace.textContent = "Sketch on selected face";
  onFace.disabled = !face?.normal || sketch.active;
  onFace.title = "Select a flat face first";
  onFace.addEventListener("click", async () => {
    try {
      const reply = await core.request<{ plane: any }>("sketch_plane", { face: currentSels[0].id });
      sketch.start(reply.plane);
      renderSketchBar();
    } catch (e) {
      status.textContent = (e as Error).message;
    }
  });
  const label = document.createElement("span");
  label.textContent = "or on";
  sketchBar.replaceChildren(
    onFace,
    label,
    ...SKETCH_PLANES.map((name) => {
      const b = document.createElement("button");
      b.textContent = name;
      b.disabled = sketch.active;
      b.addEventListener("click", async () => {
        const reply = await core.request<{ plane: any }>("sketch_plane", { plane: name });
        sketch.start(reply.plane);
        renderSketchBar();
      });
      return b;
    }),
  );
}
renderSketchBar();

// Tools without a drag parameter (and the "All tools" list) use a typed-value form with live preview.
const toolPanel = new ToolPanel($("toollist"), $("toolform"), {
  tools: () => tools,
  usable: (tool) => acceptsSelection(tool, currentSels) && (refined === null || refined.includes(tool.id)),
  async preview(tool, values) {
    try {
      const mesh = await core.request<MeshData>("tool_preview", { tool: tool.id, selection: selectionPayload(currentSels), params: values });
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
      const mesh = await core.request<MeshData>("tool_commit", { tool: tool.id, selection: selectionPayload(sels), params: values });
      setCommitted(mesh, false, mappedSelection(mesh));
    } catch (e) {
      if (committed) setCommitted(committed, false, sels);
      status.textContent = (e as Error).message;
      status.classList.add("error");
    }
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

core
  .connect()
  .then(async () => {
    tools = (await core.request<{ tools: ToolInfo[] }>("list_tools")).tools;
    renderToolbar();
    toolPanel.renderList();
    return load(select.value);
  })
  .catch((e) => (status.textContent = e.message));
