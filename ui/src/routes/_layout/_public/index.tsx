import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Building2, FileCode2, Lock, Sparkles } from "lucide-react";
import { getAccount, getActiveRuntime, getAppName, getRepository } from "@/app";
import { Button, Card, PageContainer } from "@/components";

export const Route = createFileRoute("/_layout/_public/")({
  loader: async ({ context }) => ({
    runtimeConfig: context.runtimeConfig,
  }),
  head: () => ({
    meta: [
      { title: "Welcome | app" },
      {
        name: "description",
        content: "A modern starter app built with TanStack Router and Better Auth on NEAR.",
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  const { runtimeConfig } = Route.useLoaderData();
  const appName = getAppName(runtimeConfig);
  const account = getAccount(runtimeConfig);
  const runtime = getActiveRuntime(runtimeConfig);
  const repository = getRepository(runtimeConfig);

  const accountId = runtime?.accountId ?? account;

  return (
    <PageContainer variant="wide">
      <div className="space-y-16">
        <section className="flex flex-col items-center gap-6 pt-12 pb-8 text-center">
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs font-semibold text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            {accountId}
          </div>

          <div className="space-y-3">
            <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-foreground">
              {appName}
            </h1>
            <p className="mx-auto max-w-2xl text-base sm:text-lg text-muted-foreground leading-relaxed">
              A production-ready starter built on TanStack Router, Better Auth, and Effect — with
              organization management, a guarded dashboard, and a fully typed API.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/login">
                Get started
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/about">Learn more</Link>
            </Button>
          </div>
        </section>

        <section className="grid gap-6 md:grid-cols-3">
          <Card className="p-6 space-y-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-foreground text-background">
              <Lock className="h-4 w-4" />
            </div>
            <h2 className="text-base font-semibold text-foreground">Secure authentication</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              NEAR wallet sign-in, email, and passkeys via Better Auth — with an authenticated
              layout guard and session-aware routing.
            </p>
          </Card>

          <Card className="p-6 space-y-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-foreground text-background">
              <Building2 className="h-4 w-4" />
            </div>
            <h2 className="text-base font-semibold text-foreground">Organizations</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Create and manage organizations with members, roles, invitations, and API keys — all
              backed by typed oRPC endpoints.
            </p>
          </Card>

          <Card className="p-6 space-y-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-foreground text-background">
              <FileCode2 className="h-4 w-4" />
            </div>
            <h2 className="text-base font-semibold text-foreground">Typed end to end</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              One contract drives the API and the client — schemas, validation, and types stay in
              sync across the whole stack.
            </p>
          </Card>
        </section>

        {repository && (
          <section className="flex flex-col items-center gap-4 text-center">
            <p className="text-sm text-muted-foreground">Fork the template and make it yours.</p>
            <Button asChild variant="outline">
              <a href={repository} target="_blank" rel="noopener noreferrer">
                {repository}
              </a>
            </Button>
          </section>
        )}
      </div>
    </PageContainer>
  );
}
