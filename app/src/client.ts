// WebSocket client for the Python core. Binary mesh frames follow a small
// JSON reply frame carrying the request id (see core/src/pliable/protocol.py).

export interface FaceRange {
  id: number;
  start: number;
  count: number;
  normal: [number, number, number] | null;
  centroid: [number, number, number] | null;
  /** Which solid of the model the face belongs to (hide / isolate). */
  solid?: number;
  /** Id of the body that owns the face (stable across operations); null for loose faces. */
  body?: number | null;
}

export interface EdgeRange {
  id: number;
  start: number;
  count: number;
  /** Unit direction pointing away from the material (drag axis for fillet/chamfer). */
  normal: [number, number, number] | null;
  solid?: number;
  body?: number | null;
}

export interface VertexInfo {
  id: number;
  solid?: number;
  body?: number | null;
  position: [number, number, number];
}

export interface CentreInfo {
  /** The hole or boss face this centre belongs to; picking the centre selects that face. */
  face: number;
  position: [number, number, number];
  axis: [number, number, number];
  /** Length of the hole or boss along its axis (its two axis end points are the position plus or minus half of it). */
  length?: number;
}

export interface MeshData {
  header: Record<string, any>;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  edgePositions: Float32Array;
  faces: FaceRange[];
  edges: EdgeRange[];
  vertices: VertexInfo[];
  centres: CentreInfo[];
  bounds: number[];
}

export function decodeMesh(frame: ArrayBuffer): MeshData {
  const headerLength = new DataView(frame).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(frame, 4, headerLength)));
  const base = 4 + headerLength;
  const arrays: Record<string, Float32Array | Uint32Array> = {};
  for (const b of header.buffers) {
    const Type = b.dtype === "f32" ? Float32Array : Uint32Array;
    arrays[b.name] = new Type(frame, base + b.offset, b.length);
  }
  return {
    header,
    positions: arrays.positions as Float32Array,
    normals: arrays.normals as Float32Array,
    indices: arrays.indices as Uint32Array,
    edgePositions: arrays.edgePositions as Float32Array,
    faces: header.faces,
    edges: header.edges,
    vertices: header.vertices ?? [],
    centres: header.centres ?? [],
    bounds: header.bounds,
  };
}

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; type: string; sent: number };

/** Requests that fire constantly during interaction or answer instantly; they never show the busy indicator. */
const QUIET = new Set(["hello", "tool_preview", "sketch_solve", "sketch_offset", "sketch_project", "sketch_plane", "available_tools", "list_tools", "related", "edge_chain", "edge_selection", "measure", "model_info"]);
const BUSY_AFTER_MS = 400;

export class CoreClient {
  private socket!: WebSocket;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private awaitingBinary: number | null = null;

  /** Called once when an established connection drops (the core stopped or crashed). */
  onDisconnect: () => void = () => {};

  /** Called when a slow request starts or finishes, and every 250 ms while one runs; null means idle. */
  onBusy: (busy: { type: string; seconds: number } | null) => void = () => {};
  private busyTimer: number | undefined;

  // The dev server (Vite) is a different origin from the core; the packaged app is served by the core itself.
  connect(url = import.meta.env.DEV ? `ws://127.0.0.1:${import.meta.env.VITE_CORE_PORT ?? 8765}` : `ws://${location.host}`): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.binaryType = "arraybuffer";
      let opened = false;
      // A connection that neither opens nor fails (a stalled network) must not block the retry loop.
      const giveUp = window.setTimeout(() => {
        if (!opened) {
          socket.close();
          reject(new Error("Timed out connecting to the core"));
        }
      }, 5000);
      socket.onopen = () => {
        opened = true;
        window.clearTimeout(giveUp);
        resolve();
      };
      socket.onerror = () => (window.clearTimeout(giveUp), reject(new Error("Could not connect to the core")));
      socket.onmessage = (event) => this.onMessage(event.data);
      socket.onclose = () => {
        // Requests still waiting will never be answered; fail them instead of leaving the UI on "loading".
        for (const entry of this.pending.values()) entry.reject(new Error("Lost connection to the core"));
        this.pending.clear();
        this.awaitingBinary = null;
        this.updateBusy();
        if (opened) this.onDisconnect();
      };
    });
  }

  private updateBusy() {
    const now = performance.now();
    let slow: Pending | null = null;
    for (const entry of this.pending.values()) {
      if (!QUIET.has(entry.type) && now - entry.sent >= BUSY_AFTER_MS && (!slow || entry.sent < slow.sent)) slow = entry;
    }
    this.onBusy(slow ? { type: slow.type, seconds: (now - slow.sent) / 1000 } : null);
    const waiting = [...this.pending.values()].some((e) => !QUIET.has(e.type));
    if (waiting && this.busyTimer === undefined) this.busyTimer = window.setInterval(() => this.updateBusy(), 250);
    else if (!waiting && this.busyTimer !== undefined) {
      window.clearInterval(this.busyTimer);
      this.busyTimer = undefined;
    }
  }

  private onMessage(data: string | ArrayBuffer) {
    if (typeof data !== "string") {
      const id = this.awaitingBinary;
      this.awaitingBinary = null;
      const entry = id === null ? undefined : this.pending.get(id);
      if (id !== null && entry) {
        this.pending.delete(id);
        entry.resolve(decodeMesh(data));
        this.updateBusy();
      }
      return;
    }
    const reply = JSON.parse(data);
    if (reply.binary) {
      this.awaitingBinary = reply.id;
      return;
    }
    const entry = this.pending.get(reply.id);
    if (!entry) return;
    this.pending.delete(reply.id);
    if (reply.ok) entry.resolve(reply);
    else entry.reject(new Error(reply.error));
    this.updateBusy();
  }

  isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  request<T = any>(type: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      if (this.socket?.readyState !== WebSocket.OPEN) return reject(new Error("The core is not connected"));
      this.pending.set(id, { resolve, reject, type, sent: performance.now() });
      this.updateBusy();
      this.socket.send(JSON.stringify({ id, type, ...params }));
    });
  }

  openDemo(name: string): Promise<MeshData> {
    return this.request<MeshData>("open_demo", { name });
  }
}
