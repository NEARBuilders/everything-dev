/**
 * HTML shell — head/scripts/styles, runtime config handoff.
 * Root boundary between the host-rendered document and the UI application.
 *
 * BE CAREFUL MODIFYING THIS FILE — changes will be overwritten by `bos sync` / `bos upgrade`.
 * Prefer upstream changes at https://github.com/nearbuilders/everything-dev
 */

import { TanStackDevtools } from "@tanstack/react-devtools";
import {
  ClientOnly,
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { getRemoteScripts, getThemeInitScript } from "everything-dev/ui/head";
import { getSocialImageMeta } from "everything-dev/ui/metadata";
import { MotionConfig } from "framer-motion";
import { ThemeProvider } from "next-themes";
import { useEffect, useState } from "react";
import type { RouterContext } from "@/app";
import { getBaseStyles } from "@/app";
import { RootError } from "@/components/root-error";
import { RootNotFound } from "@/components/root-not-found";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useMediaQuery } from "@/hooks";
import { resolveSessionFromCache, sessionQueryKey } from "@/lib/auth";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ context }) => {
    const session = resolveSessionFromCache(context.queryClient, context.session);

    return {
      runtimeConfig: context.runtimeConfig,
      cspNonce: context.cspNonce,
      session,
    };
  },
  loader: async ({ context }) => {
    const { queryClient } = context;
    const session = resolveSessionFromCache(queryClient, context.session);

    if (session !== undefined && queryClient) {
      queryClient.setQueryData(sessionQueryKey, session);
    }

    return {
      runtimeConfig: context.runtimeConfig,
      cspNonce: context.cspNonce,
      session,
    };
  },
  head: ({ loaderData }) => {
    const runtimeConfig = loaderData?.runtimeConfig;
    const cspNonce = loaderData?.cspNonce;
    const runtimeBasePath = runtimeConfig?.runtime?.runtimeBasePath ?? "/";
    const assetsUrl = runtimeConfig?.assetsUrl?.replace(/\/$/, "");
    const siteUrl = runtimeConfig?.hostUrl
      ? `${runtimeConfig.hostUrl}${runtimeBasePath === "/" ? "" : runtimeBasePath}`
      : "";
    const title = runtimeConfig?.runtime?.title ?? runtimeConfig?.account ?? "";
    const description = runtimeConfig?.runtime?.description ?? "";

    const structuredData = {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: title,
      description,
      url: runtimeConfig?.hostUrl || undefined,
    };

    return {
      meta: [
        { charSet: "utf-8" },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1.0, viewport-fit=cover",
        },
        { title },
        { name: "description", content: description },
        { name: "theme-color", content: "#ffffff", media: "(prefers-color-scheme: light)" },
        { name: "theme-color", content: "#0b0d10", media: "(prefers-color-scheme: dark)" },
        { name: "color-scheme", content: "light dark" },
        { name: "application-name", content: title },
        { name: "mobile-web-app-capable", content: "yes" },
        {
          name: "apple-mobile-web-app-status-bar-style",
          content: "black-translucent",
        },
        { name: "format-detection", content: "telephone=no" },
        { name: "robots", content: "index, follow" },
        ...getSocialImageMeta({
          imageUrl: siteUrl ? `${siteUrl}/metadata.png` : "/metadata.png",
          title,
          description,
          siteName: title,
          siteUrl,
          alt: description,
        }),
      ],
      links: [
        {
          rel: "stylesheet",
          href: `${assetsUrl ?? ""}/static/css/style.css${runtimeConfig?.ui?.integrity ? `?v=${encodeURIComponent(runtimeConfig.ui.integrity)}` : ""}`,
        },
        { rel: "shortcut icon", href: "/favicon.ico" },
        { rel: "icon", href: "/favicon.ico" },
        { rel: "icon", type: "image/png", sizes: "96x96", href: "/favicon-96x96.png" },
        {
          rel: "apple-touch-icon",
          sizes: "180x180",
          href: "/apple-touch-icon.png",
        },
        { rel: "manifest", href: "/site.webmanifest" },
        ...(siteUrl ? [{ rel: "canonical", href: siteUrl }] : []),
      ],
      scripts: [
        getThemeInitScript(),
        ...getRemoteScripts({
          runtimeConfig: runtimeConfig ?? undefined,
          containerName: "ui",
          hydratePath: "./Hydrate",
          integrity: runtimeConfig?.ui?.integrity,
          cspNonce,
        }),
        {
          type: "application/ld+json",
          children: JSON.stringify(structuredData),
        },
      ],
    };
  },
  component: RootComponent,
  notFoundComponent: RootNotFound,
  errorComponent: RootError,
});

function RootComponent() {
  const { cspNonce } = Route.useRouteContext();
  const isDesktop = useMediaQuery("(min-width: 640px)");
  const isSsr = typeof window === "undefined";
  return (
    <html
      lang="en"
      className="scroll-smooth"
      suppressHydrationWarning
      data-everything-ssr={isSsr ? "true" : undefined}
    >
      <head>
        <HeadContent />
        <style nonce={cspNonce} dangerouslySetInnerHTML={{ __html: getBaseStyles() }} />
      </head>
      <body>
        <MotionConfig reducedMotion="user">
          <ThemeProvider attribute="class" defaultTheme="light" enableSystem nonce={cspNonce}>
            <div id="root">
              <GlobalChrome />
            </div>
            <Toaster position={isDesktop ? "bottom-right" : "top-center"} closeButton />
          </ThemeProvider>
        </MotionConfig>
        <Scripts />
        {process.env.NODE_ENV === "development" && (
          <ClientOnly>
            <TanStackDevtools
              config={{ position: "bottom-right" }}
              plugins={[
                {
                  name: "Tanstack Router",
                  render: <TanStackRouterDevtoolsPanel />,
                },
                TanStackQueryDevtools,
              ]}
            />
          </ClientOnly>
        )}
      </body>
    </html>
  );
}

function GlobalChrome() {
  const isNavigating = useRouterState({ select: (s) => s.status === "pending" });
  const [showBar, setShowBar] = useState(false);

  useEffect(() => {
    if (!isNavigating) {
      setShowBar(false);
      return;
    }
    const t = setTimeout(() => setShowBar(true), 150);
    return () => clearTimeout(t);
  }, [isNavigating]);

  return (
    <TooltipProvider>
      <div
        className="h-dvh w-full flex flex-col overflow-hidden bg-background text-foreground"
        style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        {showBar && (
          <div className="fixed top-0 left-0 right-0 h-0.5 z-50 overflow-hidden pointer-events-none">
            <div className="h-full w-full bg-brand" />
          </div>
        )}

        <Outlet />
      </div>
    </TooltipProvider>
  );
}
