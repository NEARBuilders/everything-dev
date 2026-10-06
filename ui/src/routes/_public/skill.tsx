import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CheckIcon,
  CopyIcon,
  FileTextIcon,
  SparkleIcon,
  TerminalIcon,
} from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { getAppName } from "@/app";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { pageTitle } from "@/lib/page-title";

const INTENT_COMMAND = "npx @tanstack/intent@latest load everything-dev";

const INTENT_REGISTRY_URL = "https://tanstack.com/intent/registry/everything-dev";

const SKILL_FAMILY = [
  {
    pkg: "everything-dev",
    skills: [
      "talk-to-the-app",
      "add-a-route",
      "ui-integration",
      "plugin-development",
      "api-and-auth",
      "dev-workflow",
      "extends-config",
      "init-upgrade",
      "publish-sync",
      "registry",
      "super-app",
      "code-style",
      "cli-reference",
    ],
  },
  {
    pkg: "every-plugin",
    skills: ["plugin-development", "plugin-client", "plugin-testing"],
  },
  {
    pkg: "better-near-auth",
    skills: ["auth-plugin", "client", "siwn", "relay", "subaccount", "tanstack"],
  },
];

export const Route = createFileRoute("/_public/skill")({
  loader: async ({ context }) => {
    const runtimeConfig = context.runtimeConfig;

    const skill = await fetch("/skill.md")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load skill: ${response.status}`);
        }

        return response.text();
      })
      .catch(() => null);

    return {
      runtimeConfig,
      skill,
      intentRegistryUrl: INTENT_REGISTRY_URL,
    };
  },
  head: ({ match }) => ({
    meta: [
      { title: pageTitle("Agent skill", match.context.runtimeConfig) },
      {
        name: "description",
        content: "Agent-oriented instructions for running, editing, and publishing this runtime.",
      },
    ],
  }),
  component: SkillPage,
});

function SkillPage() {
  const { skill, runtimeConfig, intentRegistryUrl } = Route.useLoaderData();
  const appName = getAppName(runtimeConfig);
  const [copied, setCopied] = useState<"prompt" | "command" | null>(null);

  const copy = async (kind: "prompt" | "command", text: string | null) => {
    if (!text) {
      toast.error("Skill prompt unavailable");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      toast.success(kind === "prompt" ? "Skill prompt copied" : "Command copied");
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast.error("Couldn’t copy. Select the text and copy it instead.");
    }
  };

  return (
    <PageContainer variant="default">
      <Button
        variant="ghost"
        size="sm"
        className="-mb-6 self-start"
        nativeButton={false}
        render={<Link to="/about" data-testid="skill.back" />}
      >
        <ArrowLeftIcon />
        About
      </Button>
      <PageHeader
        headerTestId="skill.heading"
        icon={SparkleIcon}
        label="Docs"
        title="Agent skill"
        description={`One prompt that teaches an agent to run, change and publish ${appName}.`}
        actions={
          <>
            <Button
              onClick={() => copy("prompt", skill)}
              disabled={!skill}
              data-testid="skill.copy"
            >
              {copied === "prompt" ? <CheckIcon /> : <CopyIcon />}
              {copied === "prompt" ? "Copied" : "Copy prompt"}
            </Button>
            <Button
              variant="outline"
              nativeButton={false}
              render={(props) => (
                <a
                  {...props}
                  href="/skill.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="skill.raw-link"
                />
              )}
            >
              <FileTextIcon />
              skill.md
            </Button>
          </>
        }
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-foreground">Load it with TanStack Intent</h2>
        <div className="flex items-center gap-3 rounded-2xl bg-muted py-2 pr-2 pl-4">
          <TerminalIcon className="size-5 shrink-0 text-muted-foreground" />
          <code className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">
            {INTENT_COMMAND}
          </code>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copy command"
            onClick={() => copy("command", INTENT_COMMAND)}
          >
            {copied === "command" ? <CheckIcon /> : <CopyIcon />}
          </Button>
        </div>
        <Button
          variant="link"
          className="self-start"
          nativeButton={false}
          render={(props) => (
            <a {...props} href={intentRegistryUrl} target="_blank" rel="noopener noreferrer" />
          )}
        >
          Browse the Intent registry
          <ArrowUpRightIcon />
        </Button>
      </section>

      <section
        className="flex flex-col gap-4 border-t border-border pt-10"
        data-testid="skill.family"
      >
        <h2 className="text-lg font-medium text-foreground">The skill family</h2>
        <p className="text-sm text-muted-foreground">
          Load ONE skill for the task in front of you — each covers its common case and points to
          references for the rest. Served at
          <code className="mx-1 font-mono text-xs">
            /skills/&lt;package&gt;/&lt;skill&gt;/SKILL.md
          </code>
          or loadable with TanStack Intent.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          {SKILL_FAMILY.map((group) => (
            <div
              key={group.pkg}
              className="flex flex-col gap-2 rounded-2xl border border-border p-4"
              data-testid={`skill.family-${group.pkg}`}
            >
              <h3 className="font-mono text-sm font-medium text-foreground">{group.pkg}</h3>
              <ul className="flex flex-col gap-1">
                {group.skills.map((skill) => (
                  <li key={skill}>
                    <a
                      href={`/skills/${group.pkg}/${skill}/SKILL.md`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      data-testid={`skill.family-${group.pkg}-${skill}`}
                    >
                      {skill}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-6 border-t border-border pt-10">
        {skill ? (
          <Markdown content={skill} />
        ) : (
          <EmptyState
            icon={FileTextIcon}
            title="Skill prompt unavailable"
            description="Open skill.md directly, or try again in a moment."
          />
        )}
      </section>
    </PageContainer>
  );
}
