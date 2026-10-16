import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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

function DocsIndexPage() {
  const { runtimeConfig } = useRouter().options.context;
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) {
    return (
      <div
        className="mx-auto max-w-3xl px-4 py-16 text-sm text-muted-foreground"
        data-testid="docs.loading"
      >
        Loading docs…
      </div>
    );
  }
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-8">
      <h1 className="text-2xl font-semibold" data-testid="docs.heading">
        Docs
      </h1>
      <ul className="flex flex-col gap-2" data-testid="docs.list">
        {docs.map((doc) => (
          <li key={doc.slug}>
            <Link
              to="/docs/$"
              params={{ _splat: doc.slug }}
              className="block rounded-lg border border-border p-4 transition-colors hover:bg-accent/50"
              data-testid="docs.item"
            >
              <div className="font-medium text-foreground">{doc.title}</div>
              {doc.description && (
                <div className="mt-1 text-sm text-muted-foreground">{doc.description}</div>
              )}
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
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
