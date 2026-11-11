/** Connecting to the core: retry with a growing delay while it is not running, and again whenever the connection drops. */
import type { CoreClient } from "./client.ts";

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 8000;

export interface ConnectionHost {
  core: CoreClient;
  status: HTMLElement;
  reconnectButton: HTMLButtonElement;
  /** Whether a model is shown already (it is kept across a reconnect when the core still holds it). */
  hadModel(): boolean;
  /** Everything the page needs from the core after (re)connecting. */
  sync(hadModel: boolean): Promise<void>;
  /** The connection dropped (before the retries start). */
  dropped(): void;
}

/** Connect now, wire the Reconnect button and reconnect whenever the connection drops. */
export function connectCore(host: ConnectionHost) {
  const { core, status, reconnectButton } = host;
  let connecting = false;
  let retryTimer: number | undefined;
  let wakeRetry: (() => void) | null = null;
  reconnectButton.onclick = () => {
    if (wakeRetry) wakeRetry();
    else void connectToCore();
  };

  function waitRetry(ms: number): Promise<void> {
    return new Promise((resolve) => {
      wakeRetry = () => {
        window.clearTimeout(retryTimer);
        wakeRetry = null;
        resolve();
      };
      retryTimer = window.setTimeout(wakeRetry, ms);
    });
  }

  async function connectToCore() {
    if (connecting) return;
    connecting = true;
    const hadModel = host.hadModel();
    let delay = RETRY_MIN_MS;
    try {
      for (;;) {
        try {
          await core.connect();
          reconnectButton.hidden = true;
          status.classList.remove("error");
          await host.sync(hadModel);
          if (!core.isOpen()) throw new Error("Lost connection to the core"); // dropped while syncing: the early drop notice was ignored, so keep retrying here
          return;
        } catch {
          // Not reachable, or the connection dropped again while syncing: show it and try again.
          status.classList.add("error");
          reconnectButton.hidden = false;
          const seconds = Math.round(delay / 1000);
          status.textContent = import.meta.env.DEV
            ? `Core not reachable: is 'uv run pliable-server' running in core/? Retrying in ${seconds} s...`
            : `Pliable core not reachable. Retrying in ${seconds} s (or close this tab and start Pliable again)...`;
          await waitRetry(delay);
          delay = Math.min(delay * 2, RETRY_MAX_MS);
        }
      }
    } finally {
      connecting = false;
    }
  }

  core.onDisconnect = () => {
    host.dropped();
    status.classList.add("error");
    status.textContent = "Lost connection to the core (reconnecting...)";
    reconnectButton.hidden = false;
    void connectToCore();
  };
  void connectToCore();
}
