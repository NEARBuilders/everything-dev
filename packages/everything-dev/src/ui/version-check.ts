/**
 * The soft-refresh poller (atomic-deploys 10): a browser-side loop fetching
 * the host's `/.well-known/version` and reporting when the served deploy
 * fingerprint differs from the one this document was rendered from. No live
 * container swap — the banner decides whether to reload (old bytes are
 * retained, so a reload is always safe). Polling pauses while the document
 * is hidden and reports at most once.
 */

const DEFAULT_POLL_INTERVAL_MS = 60_000;

export interface VersionWatchHandle {
  stop: () => void;
}

export function startVersionWatch(input: {
  currentFingerprint: string;
  onNewVersion: () => void;
  intervalMs?: number;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  documentRef?: Document;
}): VersionWatchHandle {
  const intervalMs = input.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const doc = input.documentRef ?? document;
  const endpoint = input.endpoint ?? "/.well-known/version";

  let reported = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const poll = async () => {
    if (reported) return;
    try {
      const response = await fetchImpl(endpoint, { headers: { accept: "application/json" } });
      if (!response.ok) return;
      const body = (await response.json()) as { fingerprint?: string };
      if (body.fingerprint && body.fingerprint !== input.currentFingerprint) {
        reported = true;
        input.onNewVersion();
      }
    } catch {
      // unreachable origin — the next tick retries
    }
  };

  const tick = () => {
    if (doc.visibilityState !== "visible") return;
    void poll();
  };

  timer = setInterval(tick, intervalMs);
  const onVisibility = () => tick();
  doc.addEventListener("visibilitychange", onVisibility);

  return {
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
      doc.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
