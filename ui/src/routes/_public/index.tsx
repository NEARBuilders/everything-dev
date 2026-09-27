import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getActiveRuntime, getGatewayId } from "@/app";
import { Button, UnderConstruction } from "@/components";
import { PageContainer } from "@/components/layout/page-container";

export const Route = createFileRoute("/_public/")({
  head: () => ({
    meta: [
      { title: "everything.dev | Runtime composition on NEAR" },
      {
        name: "description",
        content:
          "everything.dev is an open runtime for apps on NEAR, composed from published config and loaded at runtime.",
      },
    ],
  }),
  component: Landing,
});

const subtitles = [
  <>
    An open runtime for apps on{" "}
    <a href="https://near.org" className="underline hover:text-foreground transition-colors">
      NEAR
    </a>
  </>,
  "an upgradable runtime for a verifiable internet",
  "in pursuit of the open web.",
];

function Landing() {
  const { runtimeConfig } = Route.useRouteContext();
  const [subtitleIndex, setSubtitleIndex] = useState(0);
  const activeRuntime = getActiveRuntime(runtimeConfig);
  const runtimeLabel = activeRuntime
    ? `${activeRuntime.accountId} / ${activeRuntime.gatewayId}`
    : runtimeConfig?.account
      ? `${runtimeConfig.account} / ${getGatewayId(runtimeConfig) || "gateway"}`
      : "runtime / host";

  useEffect(() => {
    const interval = setInterval(() => {
      setSubtitleIndex((i) => (i + 1) % subtitles.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <PageContainer variant="wide" className="items-center gap-16 pb-16">
      <div className="flex max-w-3xl flex-col items-center text-center">
        <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted-foreground">
          {runtimeLabel}
        </p>

        <h1 className="mt-4 text-5xl font-semibold tracking-tight sm:text-7xl">everything.dev</h1>

        <div className="mt-2 flex min-h-[1.75rem] items-center justify-center sm:min-h-[2rem]">
          <p key={subtitleIndex} className="animate-subtitle-cycle text-lg sm:text-xl">
            {subtitles[subtitleIndex]}
          </p>
        </div>

        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Published config composes the host, UI, and API at runtime. The runtime is published from
          NEAR, can share a stable host, and leaves room for new interfaces, plugins, and composed
          applications to grow around the same core record.
        </p>

        <div className="mt-5 flex flex-wrap items-start justify-center gap-3">
          <Button
            size="lg"
            nativeButton={false}
            render={<Link to="/launch" data-testid="landing-launch" preload="intent" />}
          >
            Launch a node
          </Button>
          <div className="group relative flex flex-col items-center">
            <Button size="lg" variant="outline" nativeButton={false} render={<Link to="/about" />}>
              about
            </Button>
            <a
              href="/skill.md"
              className="absolute top-full mt-1 whitespace-nowrap font-mono text-[11px] text-muted-foreground opacity-0 transition-opacity duration-200 group-hover:opacity-100 hover:text-foreground"
            >
              for your agent: skill.md
            </a>
          </div>
        </div>
      </div>

      <div className="flex w-full justify-center" data-testid="landing-construction">
        <UnderConstruction className="max-w-sm" />
      </div>

      <p className="max-w-md text-center text-xs text-muted-foreground">
        Software that stays portable, inspectable, and continuously built over time.
      </p>
    </PageContainer>
  );
}
