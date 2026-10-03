import type { ClientRuntimeConfig } from "everything-dev/types";
import { startVersionWatch, type VersionWatchHandle } from "everything-dev/ui/version-check";
import { useEffect, useState } from "react";
import { useAuthClient } from "@/lib/auth";

/**
 * Soft refresh (atomic-deploys 10): polls the host's version endpoint while
 * the document is visible and offers a reload when a newer deploy is served
 * — for signed-in sessions only (anonymous navigation picks the new version
 * up naturally). The reload is always safe: old bytes are retained, so the
 * old session keeps running until the user chooses to refresh.
 */
const VERSION_DISMISSED_KEY = "version-refresh-dismissed";

export function VersionRefreshBanner({
  runtimeConfig,
}: {
  runtimeConfig?: Partial<ClientRuntimeConfig>;
}) {
  const authClient = useAuthClient();
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(
    () =>
      typeof window !== "undefined" && window.sessionStorage.getItem(VERSION_DISMISSED_KEY) === "1",
  );

  useEffect(() => {
    const fingerprint = runtimeConfig?.deploymentFingerprint;
    if (!fingerprint || dismissed) return;

    let cancelled = false;
    let handle: VersionWatchHandle | null = null;

    const arm = async () => {
      let signedIn = false;
      try {
        const { data: session } = await authClient.getSession();
        signedIn = Boolean(session?.user);
      } catch {
        signedIn = false;
      }
      if (cancelled || !signedIn) return;
      handle = startVersionWatch({
        currentFingerprint: fingerprint,
        onNewVersion: () => setShow(true),
      });
    };
    void arm();

    return () => {
      cancelled = true;
      handle?.stop();
    };
  }, [runtimeConfig?.deploymentFingerprint, dismissed, authClient]);

  if (!show || dismissed) return null;

  return (
    <div
      data-testid="version-refresh-banner"
      role="status"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-2xl bg-background px-5 py-4 text-foreground shadow-lg"
    >
      <span className="text-sm text-muted-foreground">A new version is available.</span>
      <button
        type="button"
        data-testid="version-refresh-button"
        onClick={() => window.location.reload()}
        className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Refresh
      </button>
      <button
        type="button"
        data-testid="version-refresh-dismiss"
        onClick={() => {
          window.sessionStorage.setItem(VERSION_DISMISSED_KEY, "1");
          setDismissed(true);
        }}
        className="rounded-xl px-2 py-2 text-sm text-muted-foreground"
      >
        Dismiss
      </button>
    </div>
  );
}
