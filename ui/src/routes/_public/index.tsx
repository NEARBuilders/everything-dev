import { ArrowRightIcon, ArrowUpRightIcon } from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getAppName, getRepository } from "@/app";
import { Button, SectionHeader } from "@/components";
import { PageContainer } from "@/components/layout/page-container";

const STEPS = [
  {
    title: "Compose",
    body: "Assemble your app from published plugins — auth, registry, proposals, votes, and more load through a shared runtime.",
  },
  {
    title: "Own your runtime",
    body: "Your config is published on-chain under your account. Deploy your own instance that extends the base platform.",
  },
  {
    title: "Extend the platform",
    body: "Build plugins with oRPC contracts and Effect services, then publish them for every runtime to compose.",
  },
];

export const Route = createFileRoute("/_public/")({
  loader: async ({ context }) => {
    return { runtimeConfig: context.runtimeConfig };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: getAppName(loaderData?.runtimeConfig),
      },
      {
        name: "description",
        content:
          "Open runtime for apps on NEAR — compose published plugins, own your runtime config, and extend the platform.",
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  const { runtimeConfig } = Route.useLoaderData();
  const title = getAppName(runtimeConfig);
  const repository = getRepository(runtimeConfig);

  return (
    <PageContainer variant="wide" className="gap-20 sm:gap-24">
      <section className="flex max-w-3xl flex-col gap-6 pt-4 sm:pt-10">
        <h1 className="text-5xl font-semibold text-balance text-foreground sm:text-6xl">
          {title}
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          Open runtime for apps on NEAR — compose published plugins, own your runtime config, and
          extend the platform with your own deployments.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button size="lg" nativeButton={false} render={<Link to="/about" data-testid="landing-about" />}>
            Learn more
            <ArrowRightIcon />
          </Button>
          <Button
            size="lg"
            variant="outline"
            nativeButton={false}
            render={<Link to="/dashboard" data-testid="landing-open" />}
          >
            Open the app
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-6" data-testid="landing-steps">
        <SectionHeader title="How it works" />
        <ol className="grid gap-8 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex flex-col gap-3">
              <h3 className="text-lg font-medium text-foreground">
                <span className="text-muted-foreground">{index + 1}. </span>
                {step.title}
              </h3>
              <p className="text-sm text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {repository && (
        <section className="flex flex-col gap-6 border-t border-border pt-12 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-xl font-semibold text-foreground">Open source</h2>
            <p className="text-sm text-muted-foreground">{repository}</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              variant="ghost"
              nativeButton={false}
              render={(props) => (
                <a {...props} href={repository} target="_blank" rel="noopener noreferrer" />
              )}
            >
              View the repository
              <ArrowUpRightIcon />
            </Button>
          </div>
        </section>
      )}
    </PageContainer>
  );
}
