import { createFileRoute } from "@tanstack/react-router";

type SearchParams = {
  path?: string;
};

export const Route = createFileRoute("/_layout/")({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    path: typeof search.path === "string" && search.path.length > 0 ? search.path : undefined,
  }),
  component: HomeViewerPage,
});

function HomeViewerPage() {
  const { path } = Route.useSearch();
  const iframeSrc = path ? `./_viewer?path=${encodeURIComponent(path)}` : "./_viewer";

  return (
    <div className="h-full w-full bg-background">
      <iframe
        title="BOS viewer"
        src={iframeSrc}
        loading="eager"
        allow="clipboard-read; clipboard-write"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
        className="block h-full w-full border-0 bg-background"
      />
    </div>
  );
}
