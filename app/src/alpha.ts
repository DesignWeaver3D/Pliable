/** Alpha-release UI: the ALPHA tag, the launch notice and the Copy diagnostics dialog. */

import { usage, usageLines, type UsageRow } from "./usage";

export const ALPHA_NOTICE = "Alpha software. Not for serious work. Data can be lost. The interface and behaviour will change rapidly without notice.";
export const USAGE_NOTICE = "Pliable counts which tools you start and finish, on this computer only. The counts leave it only if you copy them from the diagnostics report yourself.";
const ISSUES_URL = "https://github.com/DesignWeaver3D/Pliable/issues/new?template=bug_report.md";

interface CoreReport {
  pliable: string;
  python: string;
  os: string;
  opencascade: string;
  build123d: string;
  lastTool: { tool: string; commit: boolean; ok: boolean; error: string | null } | null;
  importWarnings: string[];
  usage?: Record<string, UsageRow>;
  log: string[];
}

interface Requester {
  request<T = any>(type: string, params?: Record<string, unknown>): Promise<T>;
}

function overlay(): { box: HTMLDivElement; card: HTMLDivElement } {
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);z-index:100";
  const card = document.createElement("div");
  card.style.cssText = "background:#2b2b2b;color:#eee;padding:20px 24px;border-radius:8px;max-width:min(560px,92vw);font:14px sans-serif";
  box.append(card);
  document.body.append(box);
  return { box, card };
}

const BUTTON_TIPS: Record<string, string> = {
  "I understand": "Close this notice; it is not shown again",
  "Report a problem": "Open the bug report page with the details filled in",
  OK: "Close this message",
  Copy: "Copy the report text to the clipboard",
  "Open bug report page": "Open the bug report page in a new tab",
  "Clear usage counts": "Reset the tool usage counts shown here",
  Close: "Close this window",
};

function button(label: string, onclick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  b.title = BUTTON_TIPS[label] ?? "";
  b.onclick = onclick;
  return b;
}

let noticeShown = false;

/** The launch notice, shown until the user clicks I understand once (kept by the core, per user). */
export async function showLaunchNotice(core: Requester): Promise<void> {
  if (noticeShown) return;
  noticeShown = true;
  try {
    if ((await core.request<{ acknowledged: boolean }>("notice_get")).acknowledged) return;
  } catch {
    // Unknown state: show the notice rather than hide it.
  }
  const { box, card } = overlay();
  const title = document.createElement("h3");
  title.textContent = "⚠️ Pliable alpha: read before you continue";
  title.style.margin = "0 0 8px";
  card.style.border = "2px solid #ff8a1f";
  const text = document.createElement("p");
  text.textContent = ALPHA_NOTICE;
  text.style.fontSize = "16px";
  const usageNote = document.createElement("p");
  usageNote.textContent = USAGE_NOTICE;
  usageNote.style.cssText = "font-size:13px;color:#bbb";
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
  row.append(
    button("I understand", () => {
      box.remove();
      core.request("notice_ack").catch(() => {});
    }),
  );
  card.append(title, text, usageNote, row);
}

/** Shown after a STEP import with several solids or import warnings. */
export function showImportNotice(core: Requester, solids: number, warnings: string[], loadMs: number): void {
  if (solids <= 1 && !warnings.length) return;
  const { box, card } = overlay();
  card.style.border = "2px solid #ff8a1f";
  const title = document.createElement("h3");
  title.textContent = `⚠️ About this file (loaded in ${(loadMs / 1000).toFixed(1)} s)`;
  title.style.margin = "0 0 8px";
  card.append(title);
  if (solids > 1) {
    const text = document.createElement("p");
    text.textContent = `${solids} solids. Edits apply to one solid at a time and solids can't be hidden yet, so covered features are out of reach. Operations may fail.`;
    card.append(text);
  }
  if (warnings.length) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `${warnings.length} import note${warnings.length === 1 ? "" : "s"}`;
    const list = document.createElement("ul");
    for (const w of warnings) list.append(Object.assign(document.createElement("li"), { textContent: w }));
    details.append(summary, list);
    card.append(details);
  }
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:8px";
  row.append(
    button("Report a problem", () => {
      box.remove();
      void showDiagnostics(core);
    }),
    button("OK", () => box.remove()),
  );
  card.append(row);
}

/** The text a bug report needs. Browser details are added here; the core adds everything else. */
export function formatDiagnostics(report: CoreReport, browser: string): string {
  const last = report.lastTool;
  const lines = [
    `Pliable ${report.pliable}`,
    `OS: ${report.os}`,
    `Browser: ${browser}`,
    `Python ${report.python}, OpenCASCADE (OCP) ${report.opencascade}, build123d ${report.build123d}`,
    `Last tool: ${last ? `${last.tool} (${last.commit ? "commit" : "preview"}) ${last.ok ? "ok" : `failed: ${last.error}`}` : "none"}`,
  ];
  if (report.importWarnings.length) lines.push("", "Import warnings:", ...report.importWarnings);
  lines.push("", "Tool usage (counts only, since the core started):", ...usageLines(report.usage));
  lines.push("", `Core log (last ${report.log.length} lines):`, ...report.log);
  return lines.join("\n");
}

async function showDiagnostics(core: Requester): Promise<void> {
  const { box, card } = overlay();
  card.style.width = "min(640px,92vw)";
  const title = document.createElement("h3");
  title.textContent = "Diagnostics";
  title.style.margin = "0 0 8px";
  const note = document.createElement("p");
  note.textContent = "This is exactly what will be copied. It holds versions, recent log lines, the last tool run and counts of how often each tool was used. It has no model data, file paths or personal details; check it before you paste it into a bug report.";
  const area = document.createElement("textarea");
  area.readOnly = true;
  area.style.cssText = "width:100%;height:40vh;box-sizing:border-box;background:#1b1d22;color:#ddd;border:1px solid #444;font:12px monospace";
  area.value = "Collecting...";
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:8px";
  const copy = button("Copy", async () => {
    try {
      await navigator.clipboard.writeText(area.value);
      copy.textContent = "Copied";
    } catch {
      area.select();
      copy.textContent = "Select and copy by hand";
    }
  });
  const report = button("Open bug report page", () => window.open(ISSUES_URL, "_blank", "noopener"));
  const collect = async () => {
    try {
      const { report: coreReport } = await core.request<{ report: CoreReport }>("diagnostics");
      area.value = formatDiagnostics(coreReport, navigator.userAgent);
    } catch (e) {
      area.value = `Could not reach the core: ${(e as Error).message} (Browser: ${navigator.userAgent})`;
    }
  };
  const clear = button("Clear usage counts", async () => {
    await usage.clear();
    await collect();
  });
  clear.title = "Reset the tool-usage counts to zero";
  row.append(report, clear, copy, button("Close", () => box.remove()));
  card.append(title, note, area, row);
  await collect();
}

/** Adds the ALPHA tag and the diagnostics button to the top bar. */
export function installAlphaUi(bar: HTMLElement, core: Requester): void {
  const tag = document.createElement("span");
  tag.textContent = "ALPHA";
  tag.title = ALPHA_NOTICE;
  tag.style.cssText = "color:#ffb878;border-color:#ff8a1f;font-weight:600;letter-spacing:.05em";
  const diag = document.createElement("button");
  diag.textContent = "Copy diagnostics";
  diag.title = "Show the details a bug report needs, then copy them";
  diag.onclick = () => void showDiagnostics(core);
  bar.prepend(tag);
  bar.append(diag);
}
