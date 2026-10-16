import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MarkdownRenderer } from "@/components/docs/markdown-renderer";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { createDocsApiClient, resolveClientConfig } from "@/lib/api";
import "../../styles.css";

export const Route = createFileRoute("/_public/docs/$")({
  head: () => ({
    meta: [{ title: "Docs" }],
  }),
  component: DocPage,
});

interface Doc {
  slug: string;
  title: string;
  description?: string;
  tags: string[];
  order: number;
  raw: string;
}

interface DocSummary {
  slug: string;
  title: string;
}

function useDocsList(
  runtimeConfig: { hostUrl?: string; rpcBase?: string } | undefined,
): DocSummary[] {
  const [docs, setDocs] = useState<DocSummary[]>([]);
  useEffect(() => {
    const client = createDocsApiClient(resolveClientConfig(runtimeConfig));
    client
      .listPublished({ limit: 100 })
      .then(({ data }) => {
        setDocs(data.map(({ slug, title }) => ({ slug, title })));
      })
      .catch(() => undefined);
  }, [runtimeConfig?.hostUrl, runtimeConfig?.rpcBase]);
  return docs;
}

function DocPage() {
  const { runtimeConfig } = useRouter().options.context;
  const { _splat: slug } = Route.useParams();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const allDocs = useDocsList(runtimeConfig);

  useEffect(() => {
    const client = createDocsApiClient(resolveClientConfig(runtimeConfig));
    setLoading(true);
    setNotFound(false);
    client
      .getBySlug({ slug })
      .then(({ doc: found }) => {
        setDoc(found);
        setLoading(false);
      })
      .catch(() => {
        setNotFound(true);
        setLoading(false);
      });
  }, [slug, runtimeConfig?.hostUrl, runtimeConfig?.rpcBase]);

  const index = allDocs.findIndex((candidate) => candidate.slug === slug);
  const prev = index > 0 ? allDocs[index - 1] : undefined;
  const next = index >= 0 && index < allDocs.length - 1 ? allDocs[index + 1] : undefined;

  if (loading) {
    return (
      <div
        className="mx-auto max-w-3xl px-4 py-16 text-sm text-muted-foreground"
        data-testid="docs.reader-loading"
      >
        Loading…
      </div>
    );
  }
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

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-8">
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
        <MarkdownRenderer content={doc.raw} />
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
  );
}
