import { ArrowRightIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getAppName, pluginPath, sessionQueryOptions, useAuthClient } from "@/app";
import { Button, UnderConstruction } from "@/components";
import { PublicShellFooter } from "@/components/layout/public-shell";
import { useAppTranslation } from "@/i18n/runtime";

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
          "Every app is a node — owned on NEAR, composed from plugins, and updated instantly.",
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  const { runtimeConfig } = Route.useLoaderData();
  const { session: contextSession } = Route.useRouteContext();
  const auth = useAuthClient();
  const { data: session = contextSession } = useQuery(sessionQueryOptions(auth));
  const t = useAppTranslation();
  const title = getAppName(runtimeConfig);
  const signedIn = Boolean(session?.user);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="landing">
      <main className="flex flex-1 flex-col items-center justify-center gap-10 px-6 py-24 text-center">
        <h1 className="text-4xl font-semibold text-foreground sm:text-5xl">{title}</h1>
        <UnderConstruction runtimeConfig={runtimeConfig} />
        {signedIn ? (
          <Button
            size="lg"
            nativeButton={false}
            render={<Link to="/dashboard" data-testid="landing-primary" />}
          >
            Open my node
            <ArrowRightIcon />
          </Button>
        ) : (
          <Button
            size="lg"
            nativeButton={false}
            render={<Link to={pluginPath("/login")} data-testid="landing-primary" />}
          >
            {t("nav.signIn")}
            <ArrowRightIcon />
          </Button>
        )}
      </main>
      <footer className="shrink-0">
        <PublicShellFooter />
      </footer>
    </div>
  );
}
