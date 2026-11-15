import { perf } from "./devtiming.ts";

/** Turns the development timing log on (dev builds with `?dev=1` only): `[perf]` lines in the console, `window.__timing` for steps, and a line for every page task longer than 50 ms. */
export function installTimingLog() {
  perf.enabled = true;
  (window as any).__timing = perf;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) perf.note(`long task ${Math.round(e.duration)} ms (started ${Math.round(e.startTime)})`);
    }).observe({ type: "longtask", buffered: false });
  } catch {
    // long task entries are not available here
  }
}
