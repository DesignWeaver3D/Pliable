/** Rules for the top bar's status line: an error or warning stays until it is clicked (read) or another error or warning replaces it, so a plain message
 *  (such as the name of what was just selected or opened) never wipes one out; a plain message fades after a few seconds unless it is guidance for a
 *  tool or sketch that is still in use. The rules are pure (`judge`); `installStatusGuard` applies them to the element. */

export type MessageKind = "error" | "warning" | "info";

export const INFO_FADE_MS = 6000;

export interface Message {
  text: string;
  className: string;
  kind: MessageKind;
}

export interface Held extends Message {
  kind: "error" | "warning";
  read: boolean;
}

export function kindOf(text: string, hasErrorClass: boolean, hasWarnClass: boolean): MessageKind {
  if (hasErrorClass) return "error";
  if (hasWarnClass || /\bWarning:/.test(text)) return "warning";
  return "info";
}

/** What a change of the status line does: the error or warning being held, and whether the held one must be put back over a plain message. */
export function judge(held: Held | null, now: Message): { held: Held | null; restore: boolean } {
  if (now.kind !== "info") {
    const same = held !== null && held.text === now.text;
    return { held: { ...now, kind: now.kind, read: same ? held.read : false }, restore: false };
  }
  if (held && !held.read) return { held, restore: true };
  return { held: null, restore: false };
}

export interface GuardOptions {
  /** True for a plain message that guides a tool or sketch still in use (it does not fade). */
  keepInfo(text: string): boolean;
}

export function installStatusGuard(el: HTMLElement, opts: GuardOptions): void {
  let held: Held | null = null;
  let timer = 0;
  const look = () => {
    clearTimeout(timer);
    const text = (el.textContent ?? "").trim();
    const kind = kindOf(text, el.classList.contains("error"), el.classList.contains("warn"));
    const result = judge(held, { text, className: el.className, kind });
    held = result.held;
    if (result.restore && held) {
      el.className = held.className;
      // Writing the text sets off every observer of the line again, so write it only when it differs: when only the
      // class was taken off the held message, putting the text back too would let that observer and this one undo
      // each other without end.
      if (text !== held.text) el.textContent = held.text;
      return;
    }
    if (kind === "info" && text && !opts.keepInfo(text)) {
      timer = window.setTimeout(() => {
        if ((el.textContent ?? "").trim() === text && !held) el.textContent = "";
      }, INFO_FADE_MS);
    }
  };
  new MutationObserver(look).observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  el.addEventListener("click", () => {
    if (held) held.read = true;
  });
}
