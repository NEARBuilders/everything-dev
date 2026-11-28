import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { NavTree } from "@/components/docs/nav-tree";
import { resolveDocsClient } from "@/lib/api";
import { docsNavQueryOptions } from "@/lib/queries";
import "../../styles.css";

const DOCS_ROUTE_PREFIX = "/docs/";

export const Route = createFileRoute("/_public/docs")({
  staticData: {
    nav: {
      label: "Docs",
      icon: "book",
      order: 40,
    },
  },
  loader: async ({ context }) => {
    try {
      await context.queryClient.ensureQueryData(docsNavQueryOptions(resolveDocsClient(context)));
    } catch {
      // The sidebar is a progressive enhancement — the reader still renders
      // when the nav tree can't be fetched.
    }
  },
  head: () => ({
    meta: [{ title: "Docs" }],
  }),
  component: DocsLayout,
});

function DocsLayout() {
  const routerContext = useRouter().options.context;
  const { data: nav } = useQuery(docsNavQueryOptions(resolveDocsClient(routerContext)));
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const currentSlug = pathname.startsWith(DOCS_ROUTE_PREFIX)
    ? pathname.slice(DOCS_ROUTE_PREFIX.length)
    : undefined;

  return (
    <div className="mx-auto flex w-full max-w-6xl gap-8 px-4 py-6 sm:px-8">
      <aside
        className="sticky top-6 hidden max-h-[calc(100dvh-3rem)] w-64 shrink-0 self-start overflow-y-auto lg:block"
        data-testid="docs.sidebar"
      >
        {nav && <NavTree nodes={nav} currentSlug={currentSlug} />}
      </aside>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
