import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MarkdownRenderer } from "@/components/docs/markdown-renderer";
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

function DocPage() {
  const { runtimeConfig } = useRouter().options.context;
  const { _splat: slug } = Route.useParams();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

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
    <article className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold" data-testid="docs.reader-title">
          {doc.title}
        </h1>
        {doc.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {doc.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </header>
      <MarkdownRenderer content={doc.raw} />
    </article>
  );
}
