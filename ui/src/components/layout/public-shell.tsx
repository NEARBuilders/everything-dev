import { ClientOnly, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { NearBranding } from "./near-branding";
import { NetworkToggle } from "./network-toggle";
import { PublicHeader } from "./public-header";

interface PublicShellProps {
  children: ReactNode;
  footer?: ReactNode;
  focused?: boolean;
  showSignIn?: boolean;
}

export function PublicShell({
  children,
  footer,
  focused = false,
  showSignIn = true,
}: PublicShellProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="public-shell">
      <div className="sticky-offset-public flex min-h-0 flex-1 flex-col overflow-y-auto">
        <PublicHeader focused={focused} showSignIn={showSignIn} />
        <div className="flex flex-1 flex-col">{children}</div>
        {footer && <footer className="shrink-0 border-t border-border">{footer}</footer>}
      </div>
    </div>
  );
}

export function PublicShellFooter() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8">
      <nav
        aria-label="Footer"
        data-testid="public-footer"
        className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground"
      >
        <Link to="/about" className="hover:text-foreground">
          About
        </Link>
        <Link to="/skill" className="hover:text-foreground">
          Skill
        </Link>
        <a
          href="https://nearbuilders.org"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground"
        >
          nearbuilders.org
        </a>
      </nav>
      <div className="flex items-center gap-6">
        <ClientOnly>
          <NetworkToggle />
        </ClientOnly>
        <NearBranding />
      </div>
    </div>
  );
}
