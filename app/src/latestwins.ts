/**
 * Runs async jobs one at a time and keeps only the newest request that arrives while one is in flight: nothing
 * queues up behind a slow job, and an answer for a request that has since been cancelled is told it is stale.
 */
export class LatestWins<T> {
  private waiting: { value: T } | null = null;
  private running: Promise<void> | null = null;
  private epoch = 0;

  private readonly run: (value: T, current: () => boolean) => Promise<void>;

  /** `run` gets the request and a function that says whether its answer is still wanted. */
  constructor(run: (value: T, current: () => boolean) => Promise<void>) {
    this.run = run;
  }

  get busy(): boolean {
    return this.running !== null;
  }

  /** Ask for a run; replaces any request still waiting. */
  push(value: T): void {
    this.waiting = { value };
    this.start();
  }

  /** Forget the waiting request and mark the one in flight stale; resolves once that one has finished. */
  async cancel(): Promise<void> {
    this.waiting = null;
    this.epoch++;
    while (this.running) await this.running;
  }

  private start(): void {
    if (this.running || !this.waiting) return;
    const { value } = this.waiting;
    this.waiting = null;
    const epoch = this.epoch;
    this.running = this.run(value, () => epoch === this.epoch)
      .catch(() => {}) // a failing run must not stop the next one; `run` reports its own errors
      .finally(() => {
        this.running = null;
        this.start();
      });
  }
}
