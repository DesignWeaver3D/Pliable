/** How many tool buttons of the context strip fit in a given width. Widths are measured in pixels. */
export interface StripWidths {
  /** Width of each tool button, in strip order. */
  tools: number[];
  /** Total width of the selection helper buttons that always stay (0 when none). */
  helpers: number;
  /** Width of the trailing "N more / All tools" button. */
  more: number;
  /** Gap between neighbouring items. */
  gap: number;
  /** Horizontal padding and borders of the strip itself. */
  chrome: number;
}

/** The largest number of tool buttons that fits in `available` pixels together with the helpers and the more button.
 *  At least one button is kept when there is one, so the strip never turns into only "All tools". */
export function fitStripCount(w: StripWidths, available: number): number {
  const n = w.tools.length;
  if (n === 0) return 0;
  let used = w.chrome + w.more + (w.helpers > 0 ? w.helpers + w.gap : 0);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const next = used + w.tools[i] + w.gap;
    if (next > available && count >= 1) break;
    used = next;
    count++;
  }
  // Everything fits without the more button squeezing: the "All tools" button still needs its place, already counted.
  return count;
}

/** Width the strip may use: the window width less what the left and right sides keep (the strip is centred, so the larger side counts twice). */
export function stripAvailable(viewWidth: number, leftReserve: number, rightReserve: number): number {
  return Math.max(120, viewWidth - 2 * Math.max(leftReserve, rightReserve));
}
