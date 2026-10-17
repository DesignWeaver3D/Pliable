import { CoreClient, type MeshData } from "./client";
import { Viewport } from "./viewport";

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

let committed: MeshData | null = null; // last committed (non-preview) mesh

function show(mesh: MeshData, frame = false) {
  viewport.setMesh(mesh, frame);
  undoButton.disabled = !mesh.header.canUndo;
  redoButton.disabled = !mesh.header.canRedo;
}

function setCommitted(mesh: MeshData, frame = false, face: number | null = null) {
  committed = mesh;
  show(mesh, frame);
  viewport.selectFace(face);
  selected.textContent = face === null ? "" : `face ${face}`;
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
let dragFace: number | null = null;

function pump(token: number) {
  if (inFlight || queued === null || dragFace === null) return;
  const distance = queued;
  queued = null;
  const sent = performance.now();
  inFlight = core
    .request<MeshData>("preview_push_pull", { face: dragFace, distance })
    .then((mesh) => {
      if (token !== session) return;
      show(mesh);
      viewport.selectFace(mesh.header.selection?.[0] ?? null);
      const t = mesh.header.timings ?? {};
      latency.textContent = `preview ${Math.round(performance.now() - sent)} ms (op ${t.opMs} + mesh ${t.meshMs})`;
    })
    .catch((e) => {
      if (token === session) status.textContent = e.message;
    })
    .finally(() => {
      inFlight = null;
      pump(token);
    });
}

viewport.onSelect = (face) => {
  selected.textContent = face === null ? "" : `face ${face}`;
};

viewport.onFaceDrag = async (face, distance, phase) => {
  if (phase === "move") {
    dragFace = face;
    queued = distance;
    pump(session);
    return;
  }
  // End or cancel: stop previews, let the in-flight one finish, then settle.
  session++;
  queued = null;
  await inFlight;
  dragFace = null;
  try {
    if (phase === "end" && Math.abs(distance) > 1e-6) {
      const start = performance.now();
      const mesh = await core.request<MeshData>("commit_push_pull", { face, distance });
      setCommitted(mesh, false, mesh.header.selection?.[0] ?? null);
      latency.textContent = `commit ${Math.round(performance.now() - start)} ms`;
    } else if (committed) {
      setCommitted(committed, false, face);
    }
  } catch (e) {
    status.textContent = (e as Error).message;
    if (committed) setCommitted(committed, false, face);
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

core
  .connect()
  .then(() => load(select.value))
  .catch((e) => (status.textContent = e.message));
