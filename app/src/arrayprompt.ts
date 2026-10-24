/** The question asked when something outside an array form is clicked while the array is still only a preview. */
const ARRAY_TOOLS = new Set(["linear_array", "circular_array", "path_array"]);

export function isArrayTool(id: string | null): boolean {
  return id !== null && ARRAY_TOOLS.has(id);
}

/** Ask whether to keep (apply) or throw away the array being edited; resolves with the answer. */
export function askApplyOrDiscard(toolLabel: string): Promise<"apply" | "discard"> {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);z-index:100";
    const card = document.createElement("div");
    card.style.cssText = "background:#2b2b2b;color:#eee;padding:20px 24px;border-radius:8px;max-width:360px;font:14px sans-serif";
    const text = document.createElement("p");
    text.textContent = `${toolLabel} has not been applied yet. Apply it to the model, or discard it?`;
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
    for (const [label, answer, hint] of [
      ["Discard", "discard", "Throw away the array and keep the model as it was"],
      ["Apply", "apply", "Add the array to the model"],
    ] as const) {
      const button = document.createElement("button");
      button.textContent = label;
      button.title = hint;
      button.onclick = () => {
        box.remove();
        resolve(answer);
      };
      row.append(button);
    }
    card.append(text, row);
    box.append(card);
    document.body.append(box);
  });
}
