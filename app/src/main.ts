import { CoreClient, type MeshData } from "./client";
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
  armedTool = tool.id;
  renderToolbar();
  if (!status.classList.contains("error")) status.textContent = `${tool.label}: drag the selection`;
}

function setSelection(sels: Sel[]) {
  currentSels = sels;
  refined = null;
  selected.textContent = describe(sels);
  renderToolbar();
  if (sels.length === 0) return;
  core
    .request<{ tools: string[] }>("available_tools", { selection: selectionPayload(sels) })
    .then((reply) => {
      if (currentSels !== sels) return; // the selection changed while waiting
      refined = reply.tools;
      renderToolbar();
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

viewport.onItemDrag = async (sels, distance, phase) => {
  if (phase === "move") {
    if (!dragToolFor(sels)) return;
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
  if (!e.ctrlKey) return;
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

new Palette(commands);
renderToolbar();

core
  .connect()
  .then(async () => {
    tools = (await core.request<{ tools: ToolInfo[] }>("list_tools")).tools;
    renderToolbar();
    return load(select.value);
  })
  .catch((e) => (status.textContent = e.message));
