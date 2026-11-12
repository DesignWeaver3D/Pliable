/** Paces a costly follow-up request: it starts at once while it answers quickly, and waits for a pause in the edits once it has been slow. */

export interface Pacer {
  /** Run `task` unless a newer call made this one stale (`current` false) while it waited. Resolves undefined when skipped. */
  run<T>(current: () => boolean, task: () => Promise<T>): Promise<T | undefined>;
  /** Whether the last run took longer than the limit, so the next one waits first. */
  readonly slow: boolean;
}

/**
 * The core answers one request at a time, so a follow-up that takes a second (how free each point of a large sketch is)
 * holds up the next edit. While the follow-up stays under `slowMs` it runs at once, as before. After a slow run the next
 * one first waits `pauseMs`: edits that arrive in that time make it stale before it has cost anything.
 */
export function createPacer(
  slowMs: number,
  pauseMs: number,
  now: () => number = () => performance.now(),
  wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Pacer {
  let slow = false;
  return {
    get slow() {
      return slow;
    },
    async run<T>(current: () => boolean, task: () => Promise<T>): Promise<T | undefined> {
      if (slow) {
        await wait(pauseMs);
        if (!current()) return undefined;
      }
      const started = now();
      try {
        return await task();
      } finally {
        slow = now() - started > slowMs;
      }
    },
  };
}
