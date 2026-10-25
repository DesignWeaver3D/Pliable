/** The in-page prompt offered when the core was killed last time. Moved out of main.ts. */
let dismiss: (() => void) | null = null;

/** Close the prompt (a dropped connection does this), answering "start fresh" so a waiting reconnect carries on. */
export function dismissRestorePrompt() {
  dismiss?.();
}

export function askRestore(info: { name: string; steps: number; saved?: number }): Promise<boolean> {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    // A dropped connection closes the prompt, so the reconnect is not left waiting on an answer nobody can use.
    dismiss = () => {
      box.remove();
      dismiss = null;
      resolve(false);
    };
    box.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);z-index:100";
    const card = document.createElement("div");
    card.style.cssText = "background:#2b2b2b;color:#eee;padding:20px 24px;border-radius:8px;max-width:360px;font:14px sans-serif";
    const text = document.createElement("p");
    const when = info.saved ? `, saved ${new Date(info.saved * 1000).toLocaleString()}` : "";
    text.textContent = `Pliable did not close cleanly last time. Restore your last session? "${info.name}", with ${info.steps - 1} undo steps${when}.`;
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
    for (const [label, answer] of [["Start fresh", false], ["Restore", true]] as const) {
      const button = document.createElement("button");
      button.textContent = label;
      button.title = answer ? "Reopen the model and undo steps from the last session" : "Discard the last session and start empty";
      button.onclick = () => {
        box.remove();
        dismiss = null;
        resolve(answer);
      };
      row.append(button);
    }
    card.append(text, row);
    box.append(card);
    document.body.append(box);
  });
}
