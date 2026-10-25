/** Local tool-usage counts for GUI planning. The core keeps them in memory (core/src/pliable/usage.py) and they
 *  leave the machine only inside the diagnostics report the user copies. To remove: delete this file, its calls
 *  (grep "usage.") and the core module. */

export type UsageEvent = "start" | "commit" | "cancel" | "error";
export type Surface = "strip" | "search" | "drawer" | "keys" | "drag" | "other";

interface Requester {
  request<T = any>(type: string, params?: Record<string, unknown>): Promise<T>;
}

let sink: Requester | null = null;

export const usage = {
  attach(core: Requester) {
    sink = core;
  },
  /** Fire and forget: counting must never get in the way of the tool. */
  record(tool: string, event: UsageEvent, surface?: Surface) {
    sink?.request("usage_event", { tool, event, surface }).catch(() => {});
  },
  clear(): Promise<unknown> {
    return sink ? sink.request("usage_clear") : Promise.resolve();
  },
};

export interface UsageRow {
  start: number;
  commit: number;
  cancel: number;
  error: number;
  surfaces: Record<string, number>;
}

/** Report lines, one per tool, e.g. `push_pull: 5 started (strip 3, drag 2), 4 committed, 1 cancelled, 0 errors`. */
export function usageLines(table: Record<string, UsageRow> | undefined): string[] {
  const rows = Object.entries(table ?? {});
  if (!rows.length) return ["(none yet)"];
  return rows.map(([tool, r]) => {
    const where = Object.entries(r.surfaces).map(([s, n]) => `${s} ${n}`).join(", ");
    return `${tool}: ${r.start} started${where ? ` (${where})` : ""}, ${r.commit} committed, ${r.cancel} cancelled, ${r.error} errors`;
  });
}
