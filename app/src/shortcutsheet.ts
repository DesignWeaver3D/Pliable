/** A printable page of the keyboard shortcuts as they are set now: plain black on white, two columns, no scripts. */

export interface SheetRow {
  label: string;
  keys: string;
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function shortcutSheetHtml(rows: SheetRow[], title = "Pliable keyboard shortcuts"): string {
  const body = rows.map((r) => `<tr><td>${escapeHtml(r.label)}</td><td><code>${escapeHtml(r.keys || "none")}</code></td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
body{font:12pt sans-serif;color:#000;background:#fff;margin:16mm}
h1{font-size:16pt;margin:0 0 8mm}
table{border-collapse:collapse;width:100%;column-count:1}
td{padding:2px 8px;border-bottom:1px solid #ccc}
code{font:11pt monospace;white-space:nowrap}
td:last-child{text-align:right}
</style></head><body><h1>${escapeHtml(title)}</h1><table>${body}</table></body></html>`;
}
