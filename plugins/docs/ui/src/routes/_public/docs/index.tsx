import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createDocsApiClient, resolveClientConfig } from "@/lib/api";
import "../../../styles.css";

export const Route = createFileRoute("/_public/docs/")({
  head: () => ({
    meta: [{ title: "Docs" }],
  }),
  staticData: {
    nav: {
      label: "Docs",
      icon: "book",
      order: 40,
    },
  },
  component: DocsIndexPage,
});

interface DocSummary {
  slug: string;
  title: string;
  description?: string;
  tags: string[];
  order: number;
}

const UNTAGGED = "untagged";

const groupLabel = (tag: string) => (tag === UNTAGGED ? "More" : tag);

function tagOf(doc: DocSummary): string {
  return doc.tags[0] ?? UNTAGGED;
}

function DocsIndexPage() {
  const { runtimeConfig } = useRouter().options.context;
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);

  useEffect(() => {
    const client = createDocsApiClient(resolveClientConfig(runtimeConfig));
    client
      .listPublished({ limit: 100 })
      .then(({ data }) => {
        setDocs(data);
        setLoading(false);
      })
      .catch(() => {
        setError("Docs could not be loaded. Please try again.");
        setLoading(false);
      });
  }, [runtimeConfig?.hostUrl, runtimeConfig?.rpcBase]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs.filter((doc) => {
      if (tag && tagOf(doc) !== tag) return false;
      if (!q) return true;
      return `${doc.title} ${doc.slug} ${doc.description ?? ""}`.toLowerCase().includes(q);
    });
  }, [docs, query, tag]);

  const groups = useMemo(() => {
    const byTag = new Map<string, DocSummary[]>();
    for (const doc of filtered) {
      const key = tagOf(doc);
      const list = byTag.get(key) ?? [];
      list.push(doc);
      byTag.set(key, list);
    }
    return [...byTag.entries()].sort(([a], [b]) => {
      if (a === UNTAGGED) return 1;
      if (b === UNTAGGED) return -1;
      return a.localeCompare(b);
    });
  }, [filtered]);

  const tags = useMemo(
    () => [...new Set(docs.map(tagOf))].filter((t) => t !== UNTAGGED).sort(),
    [docs],
  );

  if (error) {
    return (
      <div
        className="mx-auto max-w-3xl px-4 py-16 text-sm text-destructive"
        data-testid="docs.error"
      >
        {error}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-8">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold" data-testid="docs.heading">
          Docs
        </h1>
        <span className="text-sm text-muted-foreground" data-testid="docs.count">
          {loading ? "…" : `${filtered.length} / ${docs.length}`} docs
        </span>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-2">
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
        <button
          type="button"
          onClick={() => setTag(null)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            tag === null
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-border bg-muted/50 text-muted-foreground hover:bg-muted"
          }`}
          data-testid="docs.filter-all"
        >
          All
        </button>
        {tags.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTag(tag === t ? null : t)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              tag === t
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border bg-muted/50 text-muted-foreground hover:bg-muted"
            }`}
            data-testid="docs.filter-tag"
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-sm text-muted-foreground" data-testid="docs.loading">
          Loading docs…
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-sm text-muted-foreground" data-testid="docs.empty">
          No docs match.
        </div>
      ) : (
        <div className="flex flex-col gap-8" data-testid="docs.list">
          {groups.map(([groupTag, groupDocs]) => (
            <section key={groupTag}>
              <h2
                className="mb-3 text-xs font-bold tracking-wider text-muted-foreground uppercase"
                data-testid="docs.group"
              >
                {groupLabel(groupTag)}
              </h2>
              <div className="flex flex-col gap-3">
                {groupDocs.map((doc) => (
                  <Link
                    key={doc.slug}
                    to="/docs/$"
                    params={{ _splat: doc.slug }}
                    className="rounded-xl focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    data-testid="docs.item"
                  >
                    <Card className="px-6 transition-colors hover:bg-accent/50">
                      <div className="flex items-baseline gap-3">
                        <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                          {String(doc.order).padStart(2, "0")}
                        </span>
                        <div className="min-w-0">
                          <div className="font-medium text-card-foreground">{doc.title}</div>
                          {doc.description && (
                            <div className="mt-1 text-sm text-muted-foreground">
                              {doc.description}
                            </div>
                          )}
                          {doc.tags.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {doc.tags.map((t) => (
                                <Badge key={t} variant={t === groupTag ? "default" : "secondary"}>
                                  {t}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
