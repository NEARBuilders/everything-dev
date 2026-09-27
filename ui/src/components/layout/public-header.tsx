import { BookOpenIcon, CoinsIcon, CompassIcon, ListIcon } from "@phosphor-icons/react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "./theme-toggle";
import { UserNav } from "./user-nav";

const PUBLIC_LINKS = [
  { label: "Explore", to: "/explore", icon: CompassIcon, slug: "explore" },
  { label: "Stake", to: "/stake", icon: CoinsIcon, slug: "stake" },
  { label: "Docs", to: "/about", icon: BookOpenIcon, slug: "docs" },
] as const;

interface PublicHeaderProps {
  focused?: boolean;
  showSignIn?: boolean;
}

function isActive(pathname: string, to: string) {
  if (to === "/about") return pathname === "/about" || pathname === "/skill";
  if (to === "/explore") return pathname === "/explore" || pathname.startsWith("/n/");
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function PublicHeader({ focused = false, showSignIn = true }: PublicHeaderProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <header
      className="sticky top-0 z-20 shrink-0 border-b border-border bg-background/95 backdrop-blur-md supports-[backdrop-filter]:bg-background/85"
      data-testid="public-header"
    >
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2 px-4 sm:px-8">
        <Link
          to="/"
          aria-label="CityNode home"
          data-testid="public-header-home"
          className="mr-2 shrink-0 rounded-md sm:mr-6 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Logo mark={false} size="lg" />
        </Link>
        {!focused && (
          <nav aria-label="Main navigation" className="hidden items-center gap-1 sm:flex">
            {PUBLIC_LINKS.map((link) => (
              <Button
                key={link.to}
                variant={isActive(pathname, link.to) ? "secondary" : "ghost"}
                size="sm"
                nativeButton={false}
                render={
                  <Link
                    to={link.to}
                    activeProps={{ "aria-current": "page" }}
                    data-testid={`public-nav-${link.slug}`}
                  />
                }
              >
                {link.label}
              </Button>
            ))}
          </nav>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ThemeToggle />
          {!focused && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon" className="sm:hidden" />}
                aria-label="Open menu"
                data-testid="public-nav-menu"
              >
                <ListIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {PUBLIC_LINKS.map((link) => (
                  <DropdownMenuItem key={link.to} render={<Link to={link.to} />}>
                    <link.icon />
                    {link.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <span className="ml-1">
            <UserNav showSignIn={showSignIn} />
          </span>
        </div>
      </div>
    </header>
  );
}
