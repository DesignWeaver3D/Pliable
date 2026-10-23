/** Saving a model from the core as a file through the browser, and reading a picked file for the core. Moved out of main.ts. */

export interface FileCore {
  request<T>(type: string, params?: Record<string, unknown>): Promise<T>;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Ask the core for the model in a file format and save it through the browser. `baseName` suggests the file name. */
export async function exportAs(core: FileCore, status: HTMLElement, baseName: string, request: string, extension: string, params: Record<string, unknown> = {}) {
  type Picker = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }>;
  try {
    // Where the browser has a save dialog, ask for the name and place before building the file; otherwise download.
    const pick = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;
    let handle: Awaited<ReturnType<Picker>> | null = null;
    if (pick) {
      try {
        handle = await pick({ suggestedName: `${baseName}.${extension}`, types: [{ description: extension.toUpperCase() + " file", accept: { "application/octet-stream": ["." + extension] } }] });
      } catch (e) {
        if ((e as Error).name === "AbortError") return; // cancelled in the dialog
      }
    }
    const reply = await core.request<{ name: string; data: string }>(request, params);
    if (typeof reply?.data !== "string") throw new Error(`The core did not return a file for ${request} (restart the core if it is out of date)`);
    const { name, data } = reply;
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    if (handle) {
      const out = await handle.createWritable();
      await out.write(blob);
      await out.close();
      return;
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name.replace(/\.(step|stp|stl|obj|3mf|plbl)$/i, "") + "." + extension;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (e) {
    status.textContent = (e as Error).message;
    status.classList.add("error");
  }
}
