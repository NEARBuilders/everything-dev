import { HammerIcon } from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { BuildPrompts } from "./-build-prompts";

export const Route = createFileRoute("/_public/build")({
  head: () => ({
    meta: [{ title: "Build" }],
  }),
  component: BuildPage,
});

function BuildPage() {
  return (
    <PageContainer variant="narrow">
      <PageHeader
        headerTestId="build.heading"
        icon={HammerIcon}
        title="Ready to start building?"
        description="Copy a prompt into your AI agent and build with NEAR AI Cloud and NEAR Intents."
      />
      <BuildPrompts />
    </PageContainer>
  );
}
