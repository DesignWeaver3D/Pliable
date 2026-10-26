/** The sketch's solve loop: one request to the core in flight, the newest queued request wins, and the reply moves the points. Moved out of sketch.ts. */
import type { CoreClient } from "./client";
import * as M from "./sketchmodel";
import type { Drag } from "./sketch";

interface SolveReply {
  status: "ok" | "failed";
  dof: number | null;
  failed: (number | null)[];
  points: { id: number; u: number; v: number }[];
  radii: Record<string, number>;
  /** Only when nothing is being dragged. On success: directions each point can still move in. On failure: constraints to blame. */
  freedom?: Record<string, number>;
  conflicts?: number[];
}

export interface SolveContext {
  core: CoreClient;
  /** The sketch being edited (replaced wholesale by undo, so read at call time). */
  sketch(): M.SketchData;
  status(text: string, error?: boolean | "warn"): void;
  setDof(dof: number | null): void;
  failed(): Set<number>;
  setFailed(failed: Set<number>): void;
  render(): void;
  refreshProfiles(): Promise<void>;
  refreshFreedom(): Promise<void>;
}

export function createSolver(d: SolveContext) {
  let solving = false;
  let queued: { drag?: Drag } | null = null;

  /** Solve the constraints (latest request wins while one is in flight). Resolves true if the solver succeeded. */
  function resolve(drag?: Drag): Promise<boolean> {
    queued = { drag };
    if (solving) return Promise.resolve(true);
    return run();
  }

  async function run(): Promise<boolean> {
    solving = true;
    let ok = true;
    try {
      while (queued) {
        const job = queued;
        queued = null;
        let reply: SolveReply;
        try {
          reply = await d.core.request<SolveReply>("sketch_solve", { sketch: M.forSolver(d.sketch()), drag: job.drag });
          // Which constraints to blame is only worked out for a failure, and only when nothing is being dragged.
          if (reply.status !== "ok" && !job.drag) reply = await d.core.request<SolveReply>("sketch_solve", { sketch: M.forSolver(d.sketch()), detail: true });
        } catch (e) {
          d.status((e as Error).message, true);
          ok = false;
          continue;
        }
        if (reply.status === "ok") {
          const byId = new Map(reply.points.map((p) => [p.id, p]));
          for (const p of d.sketch().points) {
            const q = byId.get(p.id);
            if (q) [p.u, p.v] = [q.u, q.v];
          }
          for (const e of d.sketch().entities) {
            if (e.type === "circle" && String(e.id) in reply.radii) e.radius = reply.radii[String(e.id)];
            if (e.type === "ellipse" && String(e.id) in reply.radii) e.minor = reply.radii[String(e.id)];
          }
          d.setDof(reply.dof);
          d.setFailed(new Set());
          ok = true;
          if (!job.drag) {
            void d.refreshProfiles();
            void d.refreshFreedom();
          }
        } else if (!job.drag) {
          d.setFailed(new Set([...reply.failed, ...(reply.conflicts ?? [])].filter((x): x is number => x !== null)));
          ok = false;
          if (!d.failed().size) d.status("The sketch could not be solved, so geometry will not follow its constraints. Undo the last change", true);
        }
        d.render();
      }
    } finally {
      solving = false;
    }
    return ok;
  }

  return { resolve, isSolving: () => solving };
}
