/** Development-only timing log (`?dev=1` in a dev build): where the time goes for each request and each redraw, written to the console as `[perf]` lines. Off by default; every call returns at once while it is off. */

export interface RequestEntry {
  id: number;
  type: string;
  /** Milliseconds since the page started: the request was sent and its reply arrived. */
  sent: number;
  arrived: number;
  /** Binary reply: time to decode the frame and time to apply it to the mesh store (both inside the arrival handler). */
  decodeMs: number;
  applyMs: number;
  bytes: number;
  /** The core's own times from the reply header (`timings`), when it has them. */
  coreMs: number | null;
  /** Requests waiting (including this one) at the moment it was sent. */
  waiting: number;
}

export interface ShowEntry {
  at: number;
  preview: boolean;
  setMeshMs: number;
  otherMs: number;
  /** From the end of `show` to the start of the next frame, and the length of that frame (draw, GPU upload). */
  toFrameMs: number;
  frameMs: number;
  triangles: number;
}

export interface Summary {
  requests: number;
  roundTripMs: number;
  coreMs: number;
  decodeMs: number;
  applyMs: number;
  setMeshMs: number;
  showOtherMs: number;
  frameMs: number;
  bytes: number;
  byType: Record<string, number>;
}

export const sumCoreMs = (timings: Record<string, unknown> | undefined | null): number | null => {
  if (!timings) return null;
  let total = 0;
  let any = false;
  for (const v of Object.values(timings)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      total += v;
      any = true;
    }
  }
  return any ? total : null;
};

/** Totals of the entries that started at or after `from`. */
export function summarize(requests: RequestEntry[], shows: ShowEntry[], from: number): Summary {
  const s: Summary = { requests: 0, roundTripMs: 0, coreMs: 0, decodeMs: 0, applyMs: 0, setMeshMs: 0, showOtherMs: 0, frameMs: 0, bytes: 0, byType: {} };
  for (const r of requests) {
    if (r.sent < from) continue;
    s.requests++;
    s.roundTripMs += r.arrived - r.sent;
    s.coreMs += r.coreMs ?? 0;
    s.decodeMs += r.decodeMs;
    s.applyMs += r.applyMs;
    s.bytes += r.bytes;
    s.byType[r.type] = (s.byType[r.type] ?? 0) + 1;
  }
  for (const h of shows) {
    if (h.at < from) continue;
    s.setMeshMs += h.setMeshMs;
    s.showOtherMs += h.otherMs;
    s.frameMs += h.toFrameMs + h.frameMs;
  }
  return s;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export const requestLine = (r: RequestEntry): string =>
  `[perf] req ${r.type}#${r.id} at ${r1(r.sent)} round-trip ${r1(r.arrived - r.sent)} core ${r.coreMs === null ? "?" : r1(r.coreMs)} decode ${r1(r.decodeMs)} apply ${r1(r.applyMs)} bytes ${r.bytes} waiting ${r.waiting}`;

export const showLine = (h: ShowEntry): string =>
  `[perf] show at ${r1(h.at)}${h.preview ? " preview" : ""} setMesh ${r1(h.setMeshMs)} other ${r1(h.otherMs)} toFrame ${r1(h.toFrameMs)} frame ${r1(h.frameMs)} tris ${h.triangles}`;

export const summaryLine = (name: string, elapsed: number, s: Summary): string =>
  `[perf] step "${name}" ${r1(elapsed)} ms: ${s.requests} requests (${Object.entries(s.byType).map(([k, v]) => `${k}x${v}`).join(" ")}) round-trip ${r1(s.roundTripMs)} core ${r1(s.coreMs)} decode ${r1(s.decodeMs)} apply ${r1(s.applyMs)} setMesh ${r1(s.setMeshMs)} showOther ${r1(s.showOtherMs)} frame ${r1(s.frameMs)} bytes ${s.bytes}`;

export class TimingLog {
  enabled = false;
  requests: RequestEntry[] = [];
  shows: ShowEntry[] = [];
  private open = new Map<number, { type: string; sent: number; waiting: number }>();
  private stepName = "";
  private stepStart = 0;

  private now: () => number;
  private out: (line: string) => void;
  private frame: (callback: () => void) => void;

  constructor(
    now: () => number = () => performance.now(),
    out: (line: string) => void = (line) => console.log(line),
    frame: (callback: () => void) => void = (callback) => requestAnimationFrame(callback),
  ) {
    this.now = now;
    this.out = out;
    this.frame = frame;
  }

  sent(id: number, type: string) {
    if (!this.enabled) return;
    this.open.set(id, { type, sent: this.now(), waiting: this.open.size + 1 });
  }

  /** A reply arrived; `decodeMs` and `applyMs` are measured by the caller around the frame read. */
  replied(id: number, info: { arrivedAt: number; decodeMs: number; applyMs: number; bytes: number; timings?: Record<string, unknown> | null }) {
    if (!this.enabled) return;
    const o = this.open.get(id);
    if (!o) return;
    this.open.delete(id);
    const entry: RequestEntry = { id, type: o.type, sent: o.sent, arrived: info.arrivedAt, decodeMs: info.decodeMs, applyMs: info.applyMs, bytes: info.bytes, coreMs: sumCoreMs(info.timings), waiting: o.waiting };
    this.requests.push(entry);
    this.out(requestLine(entry));
  }

  /** The page showed a mesh: `begin` is when `show` started, the scene rebuild ran from `setMeshStart` to `setMeshEnd`; the frame times come from the next two animation frames. */
  shown(begin: number, setMeshStart: number, setMeshEnd: number, preview: boolean, triangles: number) {
    if (!this.enabled) return;
    const end = this.now();
    const entry: ShowEntry = { at: begin, preview, setMeshMs: setMeshEnd - setMeshStart, otherMs: end - begin - (setMeshEnd - setMeshStart), toFrameMs: 0, frameMs: 0, triangles };
    this.shows.push(entry);
    this.frame(() => {
      const t1 = this.now();
      entry.toFrameMs = t1 - end;
      this.frame(() => {
        entry.frameMs = this.now() - t1;
        this.out(showLine(entry));
      });
    });
  }

  note(text: string) {
    if (this.enabled) this.out(`[perf] note at ${r1(this.now())} ${text}`);
  }

  /** Starts a named step; `endStep` logs its totals. Callable from the console as `__perf.step("name")`. */
  step(name: string) {
    this.stepName = name;
    this.stepStart = this.now();
    if (this.enabled) this.out(`[perf] step start "${name}" at ${r1(this.stepStart)}`);
  }

  endStep(): string {
    const elapsed = this.now() - this.stepStart;
    const line = summaryLine(this.stepName, elapsed, summarize(this.requests, this.shows, this.stepStart));
    if (this.enabled) this.out(line);
    return line;
  }
}

export const perf = new TimingLog();
