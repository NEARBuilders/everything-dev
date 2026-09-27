import { KeyIcon, ShieldCheckIcon, UserCircleIcon, UserIcon } from "@phosphor-icons/react";
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { sessionQueryOptions } from "everything-dev/ui/auth";
import { useEffect, useRef } from "react";
import { PageContainer, PageHeader } from "@/components";
import { Button } from "@/components/ui/button";
import "../../styles.css";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings" },
      { name: "description", content: "Manage your profile, sign-in methods and API keys." },
    ],
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(sessionQueryOptions(context.authClient));
  },
  component: SettingsLayout,
});

const tabs = [
  { value: "profile", to: "/settings/profile", label: "Profile", icon: UserIcon },
  {
    value: "auth-methods",
    to: "/settings/auth-methods",
    label: "Sign-in methods",
    icon: UserCircleIcon,
  },
  { value: "api-keys", to: "/settings/api-keys", label: "API keys", icon: KeyIcon },
  { value: "security", to: "/settings/security", label: "Security", icon: ShieldCheckIcon },
] as const;

function SettingsLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activeTab =
    tabs.find((t) => pathname === t.to || pathname.startsWith(`${t.to}/`))?.value ?? "profile";
  const activeRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (activeTab) activeRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeTab]);

  return (
    <PageContainer>
      <PageHeader title="Settings" headerTestId="settings.heading" />
      <div className="flex flex-col gap-8 md:flex-row md:gap-12">
        <nav
          aria-label="Settings"
          className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:-mx-8 sm:px-8 md:mx-0 md:w-56 md:shrink-0 md:flex-col md:overflow-visible md:px-0"
        >
          {tabs.map((tab) => {
            const active = tab.value === activeTab;
            const Icon = tab.icon;
            return (
              <Button
                key={tab.value}
                variant={active ? "secondary" : "ghost"}
                nativeButton={false}
                render={<Link to={tab.to} ref={active ? activeRef : undefined} />}
                aria-current={active ? "page" : undefined}
                data-testid={`settings-tab-${tab.value}`}
                className="shrink-0 md:w-full md:justify-start"
              >
                <Icon data-icon="inline-start" />
                <span className="flex-1 text-start">{tab.label}</span>
              </Button>
            );
          })}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-12">
          <Outlet />
        </div>
      </div>
    </PageContainer>
  );
}
