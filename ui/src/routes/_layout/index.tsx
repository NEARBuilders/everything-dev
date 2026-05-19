import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

type SearchParams = {
  path?: string;
};

declare module "react/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      "near-social-viewer": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        src?: string;
        network?: string;
      };
    }
  }
}

const DEFAULT_PATH = "every.near/widget/index";

const RUNTIME_SCRIPT_URL =
  "https://cdn.jsdelivr.net/npm/near-bos-webcomponent@0.0.6/dist/runtime.11b6858f93d8625836ab.bundle.js";

const MAIN_SCRIPT_URL =
  "https://cdn.jsdelivr.net/npm/near-bos-webcomponent@0.0.6/dist/main.a1928743fda434c0eaa2.bundle.js";

export const Route = createFileRoute("/_layout/")({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    path: typeof search.path === "string" && search.path.length > 0 ? search.path : undefined,
  }),
  component: NearSocialViewerPage,
});

function injectScript(src: string) {
  if (document.querySelector(`script[src="${src}"]`)) {
    return;
  }
  const script = document.createElement("script");
  script.src = src;
  script.defer = true;
  document.head.appendChild(script);
}

function NearSocialViewerPage() {
  const { path } = Route.useSearch();
  const viewerRef = useRef<HTMLElement>(null);
  const [scriptsLoaded, setScriptsLoaded] = useState(false);

  const widgetPath = path || DEFAULT_PATH;

  useEffect(() => {
    let cancelled = false;

    injectScript(RUNTIME_SCRIPT_URL);
    injectScript(MAIN_SCRIPT_URL);

    customElements.whenDefined("near-social-viewer").then(() => {
      if (!cancelled) {
        setScriptsLoaded(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    el.setAttribute("src", widgetPath);
    el.setAttribute("network", "mainnet");
  }, [widgetPath, scriptsLoaded]);

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex-1 min-h-0 relative">
        {scriptsLoaded ? (
          <near-social-viewer ref={viewerRef} className="absolute inset-0 w-full h-full" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            Loading viewer...
          </div>
        )}
      </div>
    </div>
  );
}
