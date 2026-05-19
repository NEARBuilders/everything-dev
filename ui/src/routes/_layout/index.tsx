import { createFileRoute } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { getAccount, getActiveRuntime, getRepository } from "@/app";
import { Markdown } from "@/components/ui/markdown";
import { useClientValue } from "@/hooks/use-client";
import { fetchRepositoryReadme } from "@/lib/repository-content";

export const Route = createFileRoute("/_layout/")({
  loader: async ({ context }) => {
    const repository = getRepository(context.runtimeConfig);
    console.log("[landing] repository:", repository);
    let readme: string | null = null;
    if (repository) {
      readme = await fetchRepositoryReadme(repository).catch((err) => {
        console.error("[landing] fetchRepositoryReadme failed:", err);
        return null;
      });
    } else {
      console.warn("[landing] no repository URL in runtime config");
    }
    return { repository, readme, runtimeConfig: context.runtimeConfig };
  },
  head: () => ({
    meta: [{ title: "app" }],
  }),
  component: Landing,
});

function Landing() {
  const { readme, runtimeConfig } = Route.useLoaderData();
  const runtime = useClientValue(() => getActiveRuntime(runtimeConfig), undefined);
  const account = useClientValue(() => getAccount(runtimeConfig), "every.near");

  const gatewayId = runtime?.gatewayId;
  const accountId = runtime?.accountId ?? account;
  const breadcrumb = gatewayId ? `${gatewayId} / ${accountId}` : accountId;

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10 animate-fade-in">
      <p className="text-xs text-muted-foreground font-mono mb-6">{breadcrumb}</p>

      {readme ? (
        <div className="rounded-2xl border border-border bg-card p-8 shadow-[rgba(0,0,0,0.06)_0px_20px_25px_-5px,rgba(0,0,0,0.03)_0px_8px_10px_-6px]">
          <Markdown content={readme} />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 px-8 py-16 text-muted-foreground">
          <FileText size={32} className="text-border" />
          <p className="text-sm text-muted-foreground">No README available.</p>
        </div>
      )}
    </div>
  );
}
