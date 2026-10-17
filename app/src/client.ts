// WebSocket client for the Python core. Binary mesh frames follow a small
// JSON reply frame carrying the request id (see core/src/pliable/protocol.py).

export interface FaceRange {
  id: number;
  start: number;
  count: number;
  normal: [number, number, number] | null;
  centroid: [number, number, number] | null;
}

export interface EdgeRange {
  id: number;
  start: number;
  count: number;
  /** Unit direction pointing away from the material (drag axis for fillet/chamfer). */
  normal: [number, number, number] | null;
}

export interface VertexInfo {
  id: number;
  position: [number, number, number];
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
    bounds: header.bounds,
  };
}

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void };

export class CoreClient {
  private socket!: WebSocket;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private awaitingBinary: number | null = null;

  connect(url = "ws://127.0.0.1:8765"): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new WebSocket(url);
      this.socket.binaryType = "arraybuffer";
      this.socket.onopen = () => resolve();
      this.socket.onerror = () => reject(new Error("Could not connect to the core"));
      this.socket.onmessage = (event) => this.onMessage(event.data);
    });
  }

  private onMessage(data: string | ArrayBuffer) {
    if (typeof data !== "string") {
      const id = this.awaitingBinary;
      this.awaitingBinary = null;
      const entry = id === null ? undefined : this.pending.get(id);
      if (id !== null && entry) {
        this.pending.delete(id);
        entry.resolve(decodeMesh(data));
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
  }

  request<T = any>(type: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, type, ...params }));
    });
  }

  openDemo(name: string): Promise<MeshData> {
    return this.request<MeshData>("open_demo", { name });
  }
}
