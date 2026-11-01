/** A bare press of Alt: Alt pressed and released with no other key and no pointer press in between, so Alt used as a modifier (Alt+click, Alt+key)
 *  never counts. Used by the sketch to toggle construction on the selection. No DOM beyond the events it is given. */
export class BareAltPress {
  private pending = false;

  /** A key went down: Alt starts a press (not a held repeat); any other key spoils it. */
  down(key: string, repeat = false) {
    if (key === "Alt") this.pending = repeat ? this.pending : true;
    else this.pending = false;
  }

  /** Something else happened (a pointer press, a wheel turn) that makes the Alt press a modifier. */
  spoil() {
    this.pending = false;
  }

  /** A key was released: true when it ends a bare Alt press. */
  up(key: string): boolean {
    if (key !== "Alt") return false;
    const bare = this.pending;
    this.pending = false;
    return bare;
  }
}
