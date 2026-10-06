import { ArrowRightIcon } from "@phosphor-icons/react";
import { ClientOnly } from "@tanstack/react-router";
import { LanguageSelector } from "@/components/layout/language-selector";
import { NearBranding } from "@/components/layout/near-branding";
import { RetroButton } from "@/components/ui/retro-prototype";
import { UnderConstructionGif } from "./under-construction-gif";

export function LandingScreen({
  signedIn,
  repository,
  onPrimary,
}: {
  signedIn: boolean;
  repository?: string;
  onPrimary: () => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background" data-testid="proto-landing">
      <main className="flex flex-1 flex-col items-center justify-center gap-12 px-6 py-24 text-center">
        <h1 className="text-5xl font-semibold text-foreground sm:text-7xl">everything.dev</h1>
        <UnderConstructionGif repository={repository} />
        <RetroButton size="xl" onClick={onPrimary} data-testid="landing-primary">
          {signedIn ? "Open my node" : "Sign in"}
          <ArrowRightIcon />
        </RetroButton>
      </main>
      <footer className="flex flex-col items-center gap-5 px-6 pt-6 pb-24 text-sm text-muted-foreground sm:flex-row sm:justify-between sm:px-10 sm:pb-8">
        <NearBranding />
        <nav
          aria-label="Footer"
          className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3"
        >
          <ClientOnly>
            <LanguageSelector />
          </ClientOnly>
          <a href="/about" className="hover:text-foreground">
            About
          </a>
          <a href="/skill" className="hover:text-foreground">
            Skill
          </a>
        </nav>
      </footer>
    </div>
  );
}
