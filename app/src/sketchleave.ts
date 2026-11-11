/** Leaving a sketch that has unsaved work: the question (keep, finish or discard) and the guard around actions that would leave. */
import type { SketchMode } from "./sketch.ts";

/** Whether leaving the sketch would lose work: drawn geometry in a new sketch, or changes to a kept one. */
export function needsConfirm(mode: SketchMode): boolean {
  return mode.kept ? mode.undoStack.length > 0 : mode.s.entities.some((e) => !e.reference);
}

/** An in-page question before a sketch with work in it is thrown away. Closing it any other way keeps editing. */
export function confirmLeave(mode: SketchMode): Promise<"keep" | "finish" | "discard"> {
  if (mode.leaveDialog?.open) return Promise.resolve("keep");
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "sketchsettings";
    dialog.addEventListener("keydown", (e) => e.stopPropagation()); // Escape closes the question (keep editing), not the sketch
    const title = document.createElement("h3");
    title.textContent = mode.kept ? "Discard your changes to this sketch?" : "Discard this sketch?";
    const text = document.createElement("div");
    text.textContent = "It has geometry that has not been kept.";
    let choice: "keep" | "finish" | "discard" = "keep";
    const choose = (c: typeof choice, label: string, autofocus = false) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.addEventListener("click", () => {
        choice = c;
        dialog.close();
      });
      if (autofocus) b.autofocus = true;
      return b;
    };
    const keep = choose("keep", "Keep editing", true);
    dialog.append(title, text, keep, choose("finish", mode.kept ? "Finish and save" : "Finish and keep"), choose("discard", "Discard"));
    dialog.addEventListener("close", () => {
      dialog.remove();
      mode.leaveDialog = null;
      resolve(choice);
    });
    document.body.append(dialog);
    mode.leaveDialog = dialog;
    dialog.showModal();
    keep.focus();
  });
}

/** Run a card button's action so that a failure shows in the status line (and the console) instead of the click seeming to do nothing. */
export async function guard(mode: SketchMode, action: () => unknown) {
  try {
    await action();
  } catch (e) {
    console.error(e);
    mode.host.status(`That did not work: ${(e as Error).message}`, true);
  }
}

/** Leave the sketch, asking first when it holds work (Escape and the Discard button). */
export async function leave(mode: SketchMode) {
  if (needsConfirm(mode)) {
    const choice = await confirmLeave(mode);
    if (choice === "keep" || !mode.active) return;
    if (choice === "finish") return mode.finish();
  }
  mode.exit();
}
