import { DeviceMobileIcon, MonitorIcon, MoonIcon, SunIcon, UserIcon } from "@phosphor-icons/react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useEffect } from "react";
import { getRepository } from "@/app";
import { PrototypeSwitcher, PrototypeSwitcherOption } from "@/components/prototype-switcher";
import { RetroProvider } from "@/components/ui/retro-prototype";
import { GalleryScreen } from "./-retro-frames/gallery";
import { LandingScreen } from "./-retro-frames/landing";
import { LoginScreen } from "./-retro-frames/login";
import { MyNodeScreen } from "./-retro-frames/my-node";
import {
  RETRO_SCREENS,
  RETRO_VARIANTS,
  type RetroScreenKey,
  type RetroVariantKey,
} from "./-retro-frames/variants";

interface RetroSearch {
  variant: RetroVariantKey;
  theme: "light" | "dark";
  screen: RetroScreenKey;
  width: "full" | "375";
  signedIn: boolean;
  embed: boolean;
}

function truthy(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

export const Route = createFileRoute("/_public/prototype/retro-frames")({
  validateSearch: (search: Record<string, unknown>): RetroSearch => ({
    variant: RETRO_VARIANTS.some((item) => item.key === search.variant)
      ? (search.variant as RetroVariantKey)
      : "A",
    theme: search.theme === "dark" ? "dark" : "light",
    screen: RETRO_SCREENS.some((item) => item.key === search.screen)
      ? (search.screen as RetroScreenKey)
      : "gallery",
    width: String(search.width) === "375" ? "375" : "full",
    signedIn: truthy(search.signedIn),
    embed: truthy(search.embed),
  }),
  beforeLoad: () => {
    if (process.env.NODE_ENV === "production") throw notFound();
  },
  loader: ({ context }) => ({ repository: getRepository(context.runtimeConfig) }),
  head: () => ({ meta: [{ title: "Prototype · retro frames" }] }),
  component: RetroFramesPrototype,
});

function useDocumentRetro(intensity: string, theme: "light" | "dark") {
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    root.dataset.retro = intensity;
    root.classList.toggle("dark", theme === "dark");
    return () => {
      delete root.dataset.retro;
      root.classList.toggle("dark", hadDark);
    };
  }, [intensity, theme]);
}

function RetroFramesPrototype() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { repository } = Route.useLoaderData();
  const active = RETRO_VARIANTS.find((item) => item.key === search.variant) ?? RETRO_VARIANTS[0];

  useDocumentRetro(active.intensity, search.theme);

  const update = (patch: Partial<RetroSearch>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  const embedSrc = `/prototype/retro-frames?${new URLSearchParams({
    variant: search.variant,
    theme: search.theme,
    screen: search.screen,
    signedIn: search.signedIn ? "1" : "0",
    embed: "1",
  }).toString()}`;

  const screen = (() => {
    switch (search.screen) {
      case "landing":
        return (
          <LandingScreen
            signedIn={search.signedIn}
            repository={repository}
            onPrimary={() => update({ screen: search.signedIn ? "node" : "login" })}
          />
        );
      case "login":
        return <LoginScreen />;
      case "node":
        return <MyNodeScreen empty={false} />;
      case "node-empty":
        return <MyNodeScreen empty />;
      default:
        return (
          <GalleryScreen variant={search.variant} onScreen={(next) => update({ screen: next })} />
        );
    }
  })();

  return (
    <RetroProvider intensity={active.intensity}>
      <div
        className="min-h-0 flex-1 overflow-y-auto bg-background"
        data-testid="retro-frames-prototype"
      >
        {search.width === "375" && !search.embed ? (
          <div className="flex min-h-full flex-col items-center gap-3 bg-muted px-4 pt-8 pb-28">
            <span className="font-mono text-xs text-muted-foreground">375 × 812</span>
            <iframe
              key={embedSrc}
              src={embedSrc}
              title="375px preview"
              className="h-203 w-93.75 shrink-0 bg-background shadow-2xl ring-1 ring-border"
            />
          </div>
        ) : (
          screen
        )}
      </div>
      {!search.embed && (
        <PrototypeSwitcher
          variants={RETRO_VARIANTS}
          current={search.variant}
          onChange={(key) => update({ variant: key as RetroVariantKey })}
        >
          <span className="mx-1 h-5 w-px bg-background/25" />
          <select
            aria-label="Screen"
            value={search.screen}
            onChange={(event) => update({ screen: event.target.value as RetroScreenKey })}
            className="h-8 cursor-pointer rounded-full bg-background/15 px-3 font-mono text-xs text-background outline-none"
          >
            {RETRO_SCREENS.map((item) => (
              <option key={item.key} value={item.key} className="text-foreground">
                {item.name}
              </option>
            ))}
          </select>
          <PrototypeSwitcherOption
            label="Toggle theme"
            active={search.theme === "dark"}
            onClick={() => update({ theme: search.theme === "dark" ? "light" : "dark" })}
          >
            {search.theme === "dark" ? (
              <MoonIcon className="size-4" />
            ) : (
              <SunIcon className="size-4" />
            )}
          </PrototypeSwitcherOption>
          <PrototypeSwitcherOption
            label="Toggle 375px width"
            active={search.width === "375"}
            onClick={() => update({ width: search.width === "375" ? "full" : "375" })}
          >
            {search.width === "375" ? (
              <DeviceMobileIcon className="size-4" />
            ) : (
              <MonitorIcon className="size-4" />
            )}
          </PrototypeSwitcherOption>
          <PrototypeSwitcherOption
            label="Toggle signed in"
            active={search.signedIn}
            onClick={() => update({ signedIn: !search.signedIn })}
          >
            <UserIcon className="size-4" />
            {search.signedIn ? "in" : "out"}
          </PrototypeSwitcherOption>
        </PrototypeSwitcher>
      )}
    </RetroProvider>
  );
}
