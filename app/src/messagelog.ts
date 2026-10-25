/** A record of the error and warning messages shown in the top bar's status line, kept for Copy diagnostics, and the way to read a long one in full. */

const KEEP = 50;
const entries: string[] = [];

const stamp = () => new Date().toTimeString().slice(0, 8);

/** The recent error and warning messages, oldest first, each with the time it appeared. */
export function recentMessages(): string[] {
  return [...entries];
}

/** Record one message (used by the observer; also callable directly). A repeat of the newest message is not stored again. */
export function recordMessage(text: string, kind: "error" | "warning") {
  const line = `${stamp()} ${kind}: ${text}`;
  if (entries.length && entries[entries.length - 1].slice(9) === line.slice(9)) return;
  entries.push(line);
  if (entries.length > KEEP) entries.shift();
}

/** Watch the status line: error and warning messages are recorded whole, and clicking a message that is cut short (or an error) calls `open` with its full text. */
export function installMessageLog(el: HTMLElement, open: (text: string) => void) {
  const look = () => {
    const text = (el.textContent ?? "").trim();
    if (!text) return;
    el.title = text;
    if (el.classList.contains("error")) recordMessage(text, "error");
    else if (el.classList.contains("warn") || /\bWarning:/.test(text)) recordMessage(text, "warning");
  };
  // Text and class are set one after the other, so look once the whole change is done.
  new MutationObserver(look).observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  el.addEventListener("click", () => {
    const text = (el.textContent ?? "").trim();
    if (text && (el.scrollWidth > el.clientWidth || el.classList.contains("error"))) open(text);
  });
}
