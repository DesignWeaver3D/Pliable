/** Widths of the context strip's parts, in pixels. */
export interface StripWidths {
  /** Width of each tool button, in strip order. */
  tools: number[];
  /** Width of each selection helper button; these always stay, after the tools. */
  helpers: number[];
  /** Width of the trailing "... More" button. */
  more: number;
  /** Gap between neighboring items. */
  gap: number;
  /** Horizontal padding and borders of the strip itself. */
  chrome: number;
}

/** Whether items of these widths, laid out left to right and wrapped, fit in `rows` rows of `limit` pixels. */
function fitsRows(items: number[], gap: number, limit: number, rows: number): boolean {
  let row = 1;
  let used = 0;
  for (const w of items) {
    const next = used > 0 ? used + gap + w : w;
    if (next > limit && used > 0) {
      row++;
      used = w;
    } else {
      used = next;
    }
  }
  return row <= rows;
}

/** How many tool buttons are shown: all of them when they (with the helpers) fit in `maxRows` rows of the available width,
 *  otherwise as many as fit in `maxRows` rows together with the helpers and the "... More" button (at least one). */
export function fitStripCount(w: StripWidths, available: number, maxRows = 2): number {
  const n = w.tools.length;
  if (n === 0) return 0;
  const limit = available - w.chrome;
  if (fitsRows([...w.tools, ...w.helpers], w.gap, limit, maxRows)) return n;
  let count = 1;
  for (let i = 2; i <= n; i++) {
    if (!fitsRows([...w.tools.slice(0, i), ...w.helpers, w.more], w.gap, limit, maxRows)) break;
    count = i;
  }
  return count;
}

/** The room for the strip: the window width less what the left side (body list, open drawer) and the right side (nav cube,
 *  view controls) keep. The strip is centered in the room that is left, so `centre` is its middle in window pixels. */
export function stripRoom(viewWidth: number, leftReserve: number, rightReserve: number): { width: number; centre: number } {
  const width = Math.max(120, viewWidth - leftReserve - rightReserve);
  return { width, centre: leftReserve + width / 2 };
}
