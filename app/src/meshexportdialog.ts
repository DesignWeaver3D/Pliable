/** The in-page prompt for the mesh export's tessellation: how far the triangles may stray from the surface (linear) and how sharply neighbors may bend (angular). */

/** The slicer's own defaults for importing a STEP file (see docs/decisions-log.md); the core uses the same numbers when none are sent. */
export const DEFAULT_LINEAR = 0.003;
export const DEFAULT_ANGULAR = 0.5;
export const LINEAR_RANGE: [number, number] = [0.0001, 10];
export const ANGULAR_RANGE: [number, number] = [0.01, 1.5];
const KEY = "pliable.meshExport";

export interface MeshOptions {
  linear: number;
  angular: number;
}

/** A typed value inside the range, or null. */
export function parseOption(text: string, range: [number, number]): number | null {
  const value = Number(text.trim());
  return text.trim() !== "" && Number.isFinite(value) && value >= range[0] && value <= range[1] ? value : null;
}

function remembered(): MeshOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    const linear = parseOption(String(saved?.linear), LINEAR_RANGE);
    const angular = parseOption(String(saved?.angular), ANGULAR_RANGE);
    if (linear !== null && angular !== null) return { linear, angular };
  } catch {
    /* storage can be blocked */
  }
  return { linear: DEFAULT_LINEAR, angular: DEFAULT_ANGULAR };
}

/** Ask for the two values; null when cancelled. The last values used are offered next time. */
export function askMeshOptions(format: string): Promise<MeshOptions | null> {
  return new Promise((resolve) => {
    const start = remembered();
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);z-index:100";
    const card = document.createElement("div");
    card.style.cssText = "background:#2b2b2b;color:#eee;padding:20px 24px;border-radius:8px;max-width:380px;font:14px sans-serif";
    const title = document.createElement("p");
    title.textContent = `Export ${format.toUpperCase()}: tessellation`;
    const note = document.createElement("p");
    note.style.cssText = "font-size:12px;opacity:.8";
    note.textContent = "Smaller values follow curved faces more closely and make a bigger file. The defaults are the ones the slicer uses when it imports a STEP file. This does not change what is drawn in the view.";
    const field = (label: string, tip: string, value: number) => {
      const row = document.createElement("label");
      row.style.cssText = "display:flex;justify-content:space-between;gap:12px;margin:8px 0";
      row.title = tip;
      const input = document.createElement("input");
      input.value = String(value);
      input.style.width = "90px";
      row.append(label, input);
      card.append(row);
      return input;
    };
    card.append(title, note);
    const linear = field("Linear deflection (mm)", "The largest distance between the true surface and the triangles that stand in for it", start.linear);
    const angular = field("Angular deflection (radians)", "The largest angle between the normals of neighboring triangles on a curved face", start.angular);
    const error = document.createElement("p");
    error.style.cssText = "color:#f66;font-size:12px;min-height:1em";
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
    const finish = (answer: MeshOptions | null) => {
      box.remove();
      resolve(answer);
    };
    const ok = document.createElement("button");
    ok.textContent = "Export";
    ok.onclick = () => {
      const l = parseOption(linear.value, LINEAR_RANGE);
      const a = parseOption(angular.value, ANGULAR_RANGE);
      if (l === null || a === null) {
        error.textContent = l === null ? `Linear deflection must be ${LINEAR_RANGE[0]} to ${LINEAR_RANGE[1]} mm` : `Angular deflection must be ${ANGULAR_RANGE[0]} to ${ANGULAR_RANGE[1]} radians`;
        return;
      }
      try {
        localStorage.setItem(KEY, JSON.stringify({ linear: l, angular: a }));
      } catch {
        /* storage can be blocked */
      }
      finish({ linear: l, angular: a });
    };
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.onclick = () => finish(null);
    box.addEventListener("keydown", (e) => {
      if (e.key === "Escape") finish(null);
      if (e.key === "Enter") ok.click();
      e.stopPropagation(); // typing here must not reach the view's key bindings
    });
    row.append(cancel, ok);
    card.append(error, row);
    box.append(card);
    document.body.append(box);
    linear.focus();
    linear.select();
  });
}
