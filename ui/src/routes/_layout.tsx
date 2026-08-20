import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

export const Route = createFileRoute("/_layout")({
  component: Layout,
});

function Layout() {
  const isNavigating = useRouterState({ select: (s) => s.status === "pending" });

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [betaBannerDismissed, setBetaBannerDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("beta-banner-dismissed") === "true";
  });

  useEffect(() => {
    localStorage.setItem("beta-banner-dismissed", String(betaBannerDismissed));
  }, [betaBannerDismissed]);

  return (
    <TooltipProvider>
      <div
        className="h-dvh w-full flex flex-col overflow-hidden bg-background text-foreground"
        style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        {!betaBannerDismissed && (
          <div className="shrink-0 flex items-center justify-center py-1.5 pl-3 pr-1 bg-yellow-300 border-b border-yellow-400">
            <span className="flex-1 text-[11px] font-bold tracking-wide text-yellow-950 text-center">
              Beta database will be wiped periodically. Do not save data you want to keep.
            </span>
            <button
              type="button"
              onClick={() => setBetaBannerDismissed(true)}
              className="shrink-0 p-1 text-yellow-950/60 hover:text-yellow-950 transition-colors cursor-pointer"
              aria-label="Dismiss beta banner"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {mounted && isNavigating && (
          <div className="fixed top-0 left-0 right-0 h-[2px] z-50 overflow-hidden pointer-events-none">
            <div className="h-full bg-foreground animate-progress-bar" style={{ width: "100%" }} />
          </div>
        )}

        <Outlet />
      </div>
    </TooltipProvider>
  );
}
