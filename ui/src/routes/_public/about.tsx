import {
  ArrowUpRightIcon,
  BookOpenIcon,
  CaretRightIcon,
  FileTextIcon,
  GitBranchIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { getAccount, getActiveRuntime, getAppName, getRepository } from "@/app";
import { Button, EmptyState, PageContainer, PageHeader } from "@/components";
import { Markdown } from "@/components/markdown";
import { pageTitle } from "@/lib/page-title";

function sanitizeMarkdownContent(content: string): string {
  return content
    .replace(/<!-- markdownlint-disable[^>]*-->/g, "")
    .replace(/<div align="center">[\s\S]*?<\/div>/g, "")
    .trim();
}

function getRawReadmeUrls(repositoryUrl: string): string[] {
  try {
    const url = new URL(repositoryUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      return [];
    }
    const [owner, repo] = parts;
    return [
      `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`,
      `https://raw.githubusercontent.com/${owner}/${repo}/master/README.md`,
    ];
  } catch {
    return [];
  }
}

async function fetchRepositoryReadme(repositoryUrl: string): Promise<string | null> {
  const candidates = getRawReadmeUrls(repositoryUrl);
  if (candidates.length === 0) return null;
  for (const url of candidates) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      return sanitizeMarkdownContent(await response.text());
    } catch {}
  }
  return null;
}

export const Route = createFileRoute("/_public/about")({
  loader: async ({ context }) => {
    const repository = getRepository(context.runtimeConfig);
    const description =
      ((context.runtimeConfig as Record<string, unknown>)?.description as string | null) ?? null;
    let readme: string | null = null;
    if (repository) {
      readme = await fetchRepositoryReadme(repository).catch(() => null);
    }
    return { repository, readme, description, runtimeConfig: context.runtimeConfig };
  },
  head: ({ match }) => ({
    meta: [
      { title: pageTitle("About", match.context.runtimeConfig) },
      { name: "description", content: "What CityNode is and how to build on it." },
    ],
  }),
  component: About,
});

function parseGithubRepo(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

function About() {
  const { repository, readme, description, runtimeConfig } = Route.useLoaderData();
  const runtime = getActiveRuntime(runtimeConfig);
  const account = getAccount(runtimeConfig);
  const appName = getAppName(runtimeConfig);

  const accountId = runtime?.accountId ?? account;
  const githubRepo = repository ? parseGithubRepo(repository) : null;

  return (
    <PageContainer variant="wide">
      <PageHeader
        headerTestId="about.heading"
        icon={BookOpenIcon}
        label="Docs"
        title={`About ${appName}`}
        description={description ?? "What this runtime is, how it's built, and how to build on it."}
        actions={
          <>
            <Button
              nativeButton={false}
              render={<Link to="/skill" preload="intent" data-testid="about.open-skill-link" />}
            >
              <SparkleIcon />
              Open agent skill
            </Button>
            {repository && (
              <Button
                variant="outline"
                nativeButton={false}
                render={(props) => (
                  <a {...props} href={repository} target="_blank" rel="noopener noreferrer" />
                )}
              >
                <GitBranchIcon />
                Source code
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-12 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          {readme ? (
            <Markdown content={readme} />
          ) : (
            <EmptyState
              icon={FileTextIcon}
              title="No README yet"
              description="This runtime hasn't published a README."
              className="rounded-3xl border border-dashed border-border"
            />
          )}
        </div>
        <aside className="flex flex-col gap-8 lg:sticky lg:top-8 lg:self-start">
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-medium text-foreground">Build on it</h2>
            <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border">
              <DocLink
                to="/skill"
                icon={<SparkleIcon className="size-5" />}
                title="Agent skill"
                meta="Run, change and publish with an agent"
              />
              <DocLink
                href="/skill.md"
                icon={<FileTextIcon className="size-5" />}
                title="skill.md"
                meta="Raw markdown prompt"
              />
              {repository && (
                <DocLink
                  href={repository}
                  icon={<GitBranchIcon className="size-5" />}
                  title={githubRepo ? `${githubRepo.owner}/${githubRepo.repo}` : "Repository"}
                  meta="Source code"
                />
              )}
            </ul>
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-medium text-foreground">Runtime</h2>
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex flex-col gap-0.5">
                <dt className="text-muted-foreground">Account</dt>
                <dd className="font-mono break-all text-foreground">{accountId}</dd>
              </div>
              {runtime?.gatewayId && (
                <div className="flex flex-col gap-0.5">
                  <dt className="text-muted-foreground">Gateway</dt>
                  <dd className="font-mono break-all text-foreground">{runtime.gatewayId}</dd>
                </div>
              )}
            </dl>
          </section>
        </aside>
      </div>
    </PageContainer>
  );
}

function DocLink({
  to,
  href,
  icon,
  title,
  meta,
}: {
  to?: "/skill";
  href?: string;
  icon: ReactNode;
  title: string;
  meta: string;
}) {
  const className =
    "group flex min-h-16 items-center gap-3 bg-card px-4 py-3 transition-colors hover:bg-muted";
  const content = (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground group-hover:bg-background">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="truncate font-medium text-foreground">{title}</div>
        <div className="truncate text-sm text-muted-foreground">{meta}</div>
      </div>
      {to ? (
        <CaretRightIcon className="size-4 text-muted-foreground" />
      ) : (
        <ArrowUpRightIcon className="size-4 text-muted-foreground" />
      )}
    </>
  );
  return (
    <li>
      {to ? (
        <Link to={to} preload="intent" className={className}>
          {content}
        </Link>
      ) : (
        <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
          {content}
        </a>
      )}
    </li>
  );
}
