import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMemo } from "react";
import { dedupeLeadingTitle } from "@/components/docs/doc-links";
import { extractToc, MarkdownRenderer } from "@/components/docs/markdown-renderer";
import { NavTree } from "@/components/docs/nav-tree";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { resolveDocsClient } from "@/lib/api";
import { docsNavQueryOptions } from "@/lib/queries";
import type { DocOutput, NavNodeShape } from "../../../../src/contract";
import { prettifySegment } from "../../../../src/lib/labels";

interface DocLoaderData {
  doc: DocOutput | null;
  notFound: boolean;
  slug: string;
}

interface Breadcrumb {
  label: string;
  slug: string | null;
}

interface FlatEntry {
  slug: string;
  title: string;
}

const isNotFound = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "NOT_FOUND";

export const Route = createFileRoute("/_public/docs/$")({
  loader: async ({ context, params }) => {
    const client = resolveDocsClient(context);
    await context.queryClient.prefetchQuery(docsNavQueryOptions(client));
    const slug = params._splat ?? "";
    try {
      const { doc } = await client.getBySlug({ slug });
      return { doc, notFound: false, slug };
    } catch (error) {
      if (!isNotFound(error)) throw error;
      return { doc: null, notFound: true, slug };
    }
  },
  head: ({ loaderData }) => {
    const doc = loaderData?.doc;
    if (!doc) return { meta: [{ title: "Docs" }] };
    return doc.description
      ? {
          meta: [
            { title: `${doc.title} — Docs` },
            { name: "description", content: doc.description },
          ],
        }
      : { meta: [{ title: `${doc.title} — Docs` }] };
  },
  pendingComponent: () => (
    <div className="py-16 text-sm text-muted-foreground" data-testid="docs.reader-loading">
      Loading…
    </div>
  ),
  component: DocPage,
});

function DocPage() {
  const data = Route.useLoaderData() as DocLoaderData | undefined;
  const doc = data?.doc ?? null;
  const notFound = data?.notFound ?? true;
  const slug = data?.slug ?? "";
  const routerContext = useRouter().options.context;
  const { data: nav } = useQuery(docsNavQueryOptions(resolveDocsClient(routerContext)));

  const flat = useMemo(() => {
    const out: FlatEntry[] = [];
    const walk = (nodes: readonly NavNodeShape[]): void => {
      for (const node of nodes) {
        if (node.slug) out.push({ slug: node.slug, title: node.title ?? node.label });
        walk(node.children);
      }
    };
    walk(nav ?? []);
    return out;
  }, [nav]);

  const toc = useMemo(() => (doc ? extractToc(doc.raw) : []), [doc]);

  if (notFound || !doc) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16" data-testid="docs.not-found">
        <h1 className="text-2xl font-semibold">Doc not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          No doc is published at <code className="rounded bg-muted px-1 py-0.5">/docs/{slug}</code>.
        </p>
      </div>
    );
  }

  const index = flat.findIndex((entry) => entry.slug === doc.slug);
  const prev = index > 0 ? flat[index - 1] : undefined;
  const next = index >= 0 && index < flat.length - 1 ? flat[index + 1] : undefined;

  const segments = doc.slug.split("/");
  const crumbs: Breadcrumb[] = [];
  for (let i = 0; i < segments.length - 1; i += 1) {
    const prefix = segments.slice(0, i + 1).join("/");
    const page = flat.find((entry) => entry.slug === prefix);
    crumbs.push({ label: prettifySegment(segments[i] ?? ""), slug: page?.slug ?? null });
  }

  return (
    <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_15rem]">
      <div className="min-w-0">
        {nav && (
          <details className="mb-4 lg:hidden" data-testid="docs.mobile-tree">
            <summary className="cursor-pointer list-none px-2 py-1 text-xs font-bold tracking-wider text-muted-foreground uppercase select-none hover:text-foreground">
              Browse docs
            </summary>
            <div className="mt-2">
              <NavTree nodes={nav} currentSlug={doc.slug} />
            </div>
          </details>
        )}
        {crumbs.length > 0 && (
          <nav
            aria-label="Breadcrumb"
            className="mb-4 flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
            data-testid="docs.breadcrumbs"
          >
            {crumbs.map((crumb, i) => (
              <span key={`${crumb.label}-${i}`} className="flex items-center gap-1">
                {i > 0 && <span aria-hidden>/</span>}
                {crumb.slug ? (
                  <Link
                    to="/docs/$"
                    params={{ _splat: crumb.slug }}
                    className="hover:text-foreground"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span>{crumb.label}</span>
                )}
              </span>
            ))}
            <span aria-hidden>/</span>
            <span className="text-foreground">{doc.title}</span>
          </nav>
        )}
        <Card className="px-6 py-8 sm:px-10" data-testid="docs.reader">
          <header className="mb-8 border-b border-border/40 pb-6">
            <h1 className="text-3xl font-semibold" data-testid="docs.reader-title">
              {doc.title}
            </h1>
            {doc.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5" data-testid="docs.reader-tags">
                {doc.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </header>
          <div className="max-w-[48rem]">
            <MarkdownRenderer content={dedupeLeadingTitle(doc.raw, doc.title)} slug={doc.slug} />
          </div>
          {(prev || next) && (
            <nav
              className="mt-10 flex justify-between gap-4 border-t border-border/40 pt-5"
              data-testid="docs.reader-nav"
            >
              {prev ? (
                <Link
                  to="/docs/$"
                  params={{ _splat: prev.slug }}
                  className="min-w-0 truncate text-sm text-primary hover:underline"
                  data-testid="docs.prev"
                >
                  ← {prev.title}
                </Link>
              ) : (
                <span />
              )}
              {next && (
                <Link
                  to="/docs/$"
                  params={{ _splat: next.slug }}
                  className="ml-auto min-w-0 truncate text-right text-sm text-primary hover:underline"
                  data-testid="docs.next"
                >
                  {next.title} →
                </Link>
              )}
            </nav>
          )}
        </Card>
      </div>
      {toc.length > 0 && (
        <nav
          aria-label="On this page"
          className="sticky top-6 hidden max-h-[calc(100dvh-3rem)] self-start overflow-y-auto text-sm xl:block"
          data-testid="docs.toc"
        >
          <h2 className="mb-2 text-xs font-bold tracking-wider text-muted-foreground uppercase">
            On this page
          </h2>
          <ul className="flex flex-col gap-1 border-l border-border">
            {toc.map((entry) => (
              <li key={entry.id}>
                <a
                  href={`#${entry.id}`}
                  className={`block truncate py-0.5 pl-3 transition-colors ${
                    entry.depth === 2
                      ? "text-muted-foreground hover:text-foreground"
                      : "pl-6 text-xs text-muted-foreground/80 hover:text-foreground"
                  }`}
                >
                  {entry.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
