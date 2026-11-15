/**
 * Lets identical read-only questions that are asked while the first is still unanswered share its answer: a face click
 * reaches the selection code twice (the press and the click), and the core answers one question at a time, so each
 * repeat doubled the wait. A question asked after the answer came is asked again.
 */
export class SharedQueries {
  private readonly open = new Map<string, Promise<unknown>>();

  /** The answer of `start()` for `key`, started only when no question with that key is open. */
  share<T>(key: string, start: () => Promise<T>): Promise<T> {
    const held = this.open.get(key);
    if (held) return held as Promise<T>;
    const asked = start();
    this.open.set(key, asked);
    const done = () => {
      if (this.open.get(key) === asked) this.open.delete(key);
    };
    asked.then(done, done);
    return asked;
  }

  /** Stop sharing the answers still awaited (the model may have changed); their askers still get them. */
  forget(): void {
    this.open.clear();
  }
}
