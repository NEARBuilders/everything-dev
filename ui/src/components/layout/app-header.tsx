import { UsersIcon } from "@phosphor-icons/react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Fragment } from "react";
import type { ClientRuntimeConfig } from "@/app";
import { getAppName } from "@/app";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { crumbsFor } from "./breadcrumbs";
import { ThemeToggle } from "./theme-toggle";
import { useIdentity } from "./use-identity";
import { useTeamWorkspace } from "./use-team-workspace";
import { UserNav } from "./user-nav";

interface AppHeaderProps {
  runtimeConfig?: Partial<ClientRuntimeConfig>;
}

export function AppHeader({ runtimeConfig }: AppHeaderProps) {
  const { user, organizations } = useIdentity();
  const { data: workspace } = useTeamWorkspace(!!user);
  const activeTeamName = workspace?.activeTeam?.name;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tab = useRouterState({
    select: (s) => {
      const value = (s.location.search as Record<string, unknown>).tab;
      return typeof value === "string" ? value : undefined;
    },
  });
  const crumbs = crumbsFor(pathname, {
    tab,
    appName: getAppName(runtimeConfig),
    orgName: (slug) => organizations.find((org) => org.slug === slug)?.name,
  });

  return (
    <header className="sticky top-0 z-10 shrink-0 border-b border-border bg-background">
      <div className="flex h-14 min-w-0 items-center gap-3 px-4 sm:px-6">
        <SidebarTrigger />

        <Breadcrumb className="min-w-0 flex-1" data-testid="app-header-breadcrumb">
          <BreadcrumbList className="flex-nowrap">
            {crumbs.map((crumb, index) => {
              const isLast = index === crumbs.length - 1;
              return (
                <Fragment key={`${crumb.label}-${index}`}>
                  {index > 0 && <BreadcrumbSeparator className="hidden sm:flex" />}
                  <BreadcrumbItem className={isLast ? "min-w-0" : "hidden sm:inline-flex"}>
                    {isLast || !crumb.to ? (
                      <BreadcrumbPage>
                        <span className="block truncate">{crumb.label}</span>
                      </BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink render={<Link to={crumb.to} />}>{crumb.label}</BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>

        {activeTeamName && (
          <div
            className="flex min-w-0 max-w-40 shrink items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground sm:max-w-64"
            data-testid="workspace-active-team"
            title={`Working as ${activeTeamName}`}
          >
            <UsersIcon className="size-4 shrink-0" />
            <span className="truncate">
              <span className="hidden sm:inline">Working as </span>
              <span className="font-medium text-foreground">{activeTeamName}</span>
            </span>
          </div>
        )}
        <div className="flex shrink-0 items-center gap-1">
          <ThemeToggle />
          <UserNav />
        </div>
      </div>
    </header>
  );
}
