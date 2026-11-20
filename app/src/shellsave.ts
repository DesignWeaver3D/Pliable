/** Learning whether a file handed to the desktop shell as a download was really saved. On macOS and Linux the shell shows the
 *  Save As dialog after the page has let go of the file, so only the shell knows if it was written or cancelled; it reports back
 *  by calling `__pliableDownloadSaved(name, saved)` on the page, and sets `__pliableShellSaves` so the page knows to wait for it. */

export interface ShellWindow {
  __pliableShellSaves?: boolean;
  __pliableDownloadSaved?: (name: string, saved: boolean) => void;
}

const waiting = new Map<string, ((saved: boolean) => void)[]>();

/** Whether this window's downloads are saved by the shell, which then reports the outcome. */
export function shellReportsSaves(w: ShellWindow): boolean {
  return w.__pliableShellSaves === true;
}

/** A promise for the outcome of the download named `name`: true once the shell says it was written, false if it was cancelled or failed.
 *  It stays pending if the shell never reports, so nothing is ever taken as saved by default. */
export function shellSaveOutcome(w: ShellWindow, name: string): Promise<boolean> {
  w.__pliableDownloadSaved ??= (reported, saved) => {
    const first = waiting.get(reported)?.shift(); // downloads of one name are answered in the order they were started
    if (!waiting.get(reported)?.length) waiting.delete(reported);
    first?.(saved);
  };
  return new Promise((resolve) => waiting.set(name, [...(waiting.get(name) ?? []), resolve]));
}
