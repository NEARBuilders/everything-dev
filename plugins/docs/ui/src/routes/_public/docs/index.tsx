import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { NavTree } from "@/components/docs/nav-tree";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { resolveDocsClient } from "@/lib/api";
import { docsNavQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_public/docs/")({
  head: () => ({
    meta: [{ title: "Docs" }],
  }),
  component: DocsIndexPage,
});

interface DocSummary {
  slug: string;
  title: string;
  description?: string;
  tags: string[];
}

function DocsIndexPage() {
  const routerContext = useRouter().options.context;
  const client = resolveDocsClient(routerContext);
  const { data: nav } = useQuery(docsNavQueryOptions(client));

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DocSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const debounced = useDebounced(query);

  const total = useMemo(() => {
    let count = 0;
    const walk = (nodes: readonly { slug: string | null; children: readonly unknown[] }[]) => {
      for (const node of nodes) {
        if (node.slug) count += 1;
        walk(node.children as typeof nodes);
      }
    };
    walk(nav ?? []);
    return count;
  }, [nav]);

  useEffect(() => {
    const q = debounced.trim();
    if (!q) {
      setResults(null);
      setSearching(false);
      return;
    }
    let alive = true;
    setSearching(true);
    client
      .listPublished({ q, limit: 50 })
      .then(({ data }) => {
        if (alive) {
          setResults(data);
          setSearching(false);
        }
      })
      .catch(() => {
        if (alive) {
          setResults([]);
          setSearching(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [debounced, client]);

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold" data-testid="docs.heading">
          Docs
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Guides, ADRs, and reference for this runtime — the repository's own markdown, served
          read-only.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <div className="relative w-full sm:max-w-xs">
          <MagnifyingGlassIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search docs…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-9"
            data-testid="docs.search"
          />
        </div>
        <span className="text-sm text-muted-foreground" data-testid="docs.count">
          {searching ? "…" : `${results ? results.length : total} / ${total} docs`}
        </span>
      </div>

      {searching ? (
        <div className="py-16 text-sm text-muted-foreground" data-testid="docs.loading">
          Searching…
        </div>
      ) : results ? (
        <SearchResults results={results} />
      ) : nav ? (
        <div data-testid="docs.list">
          <NavTree nodes={nav} />
        </div>
      ) : (
        <div className="py-16 text-sm text-muted-foreground" data-testid="docs.loading">
          Loading docs…
        </div>
      )}
    </div>
  );
}

function SearchResults({ results }: { results: DocSummary[] }) {
  if (results.length === 0) {
    return (
      <div className="py-16 text-sm text-muted-foreground" data-testid="docs.empty">
        No docs match.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="docs.list">
      {results.map((doc) => (
        <Link
          key={doc.slug}
          to="/docs/$"
          params={{ _splat: doc.slug }}
          className="rounded-xl focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          data-testid="docs.item"
        >
          <Card className="px-6 transition-colors hover:bg-accent/50">
            <div className="min-w-0">
              <div className="font-medium text-card-foreground">{doc.title}</div>
              {doc.description && (
                <div className="mt-1 text-sm text-muted-foreground">{doc.description}</div>
              )}
              {doc.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {doc.tags.map((t) => (
                    <Badge key={t} variant="secondary">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

function useDebounced(value: string): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), 200);
    return () => window.clearTimeout(timer);
  }, [value]);
  return debounced;
}
