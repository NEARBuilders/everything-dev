import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { getSocialImageMeta } from "everything-dev/ui/metadata";
import { Globe, User } from "lucide-react";
import { useAuthClient } from "@/app";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  PageContainer,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components";
import { getNearInitials, resolveNearImageUrl } from "@/lib/near-profile";

export const Route = createFileRoute("/_layout/_public/$accountId")({
  loader: async ({ params, context }) => {
    const { queryClient, authClient, runtimeConfig } = context;
    const accountId = params.accountId;

    await queryClient.prefetchQuery({
      queryKey: ["near-profile", accountId],
      queryFn: async () => {
        const { data } = await authClient.near.getProfile(accountId);
        return data ?? null;
      },
      staleTime: 5 * 60 * 1000,
    });

    return { accountId, hostUrl: runtimeConfig?.hostUrl ?? "" };
  },
  head: ({ loaderData, params }) => {
    const accountId = params.accountId;
    const hostUrl = (loaderData?.hostUrl ?? "").replace(/\/$/, "");
    const siteUrl = hostUrl ? `${hostUrl}/${accountId}` : "";
    const title = `${accountId} | everything.dev`;
    const description = `${accountId}'s public profile on everything.dev.`;

    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...getSocialImageMeta({
          imageUrl: hostUrl ? `${hostUrl}/metadata.png` : "/metadata.png",
          title,
          description,
          siteUrl,
          type: "profile",
          alt: description,
        }),
      ],
    };
  },
  component: AccountProfileLayout,
});

const tabs = [
  { value: "overview", to: "/$accountId", label: "Overview", exact: true },
  { value: "apps", to: "/$accountId/apps", label: "Apps", exact: false },
] as const;

function AccountProfileLayout() {
  const { accountId } = Route.useLoaderData();
  const authClient = useAuthClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const resolveTabPath = (to: string) => to.replace("$accountId", accountId);
  const activeTab =
    tabs.find((t) => {
      const fullPath = resolveTabPath(t.to);
      return t.exact
        ? pathname === fullPath
        : pathname === fullPath || pathname.startsWith(`${fullPath}/`);
    })?.value ?? "overview";

  const { data: profile } = useQuery({
    queryKey: ["near-profile", accountId],
    queryFn: async () => {
      const { data } = await authClient.near.getProfile(accountId);
      return data ?? null;
    },
    staleTime: 5 * 60 * 1000,
  });

  const backgroundUrl = resolveNearImageUrl(profile?.backgroundImage);
  const avatarUrl = resolveNearImageUrl(profile?.image);
  const displayName = profile?.name || accountId;
  const initials = getNearInitials(profile?.name || accountId);
  const linktree = profile?.linktree ? Object.entries(profile.linktree) : [];

  return (
    <PageContainer variant="default">
      <div className="space-y-6">
        <div className="overflow-hidden rounded-[12px] border border-border bg-card">
          <div
            className="h-32 sm:h-44 w-full bg-muted"
            style={
              backgroundUrl
                ? {
                    backgroundImage: `url(${backgroundUrl})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }
                : undefined
            }
          />
          <div className="px-6 pb-6">
            <Avatar className="-mt-10 size-20 border-4 border-card ring-1 ring-border bg-card">
              {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
              <AvatarFallback className="text-xl font-semibold">
                {initials || <User className="size-8" />}
              </AvatarFallback>
            </Avatar>

            <div className="mt-3 space-y-1">
              <h1 className="text-xl font-bold text-foreground">{displayName}</h1>
              <p className="font-mono text-sm text-muted-foreground">{accountId}</p>
            </div>

            {profile?.description && (
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {profile.description}
              </p>
            )}

            {linktree.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {linktree.map(([label, url]) => (
                  <a
                    key={label}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-border"
                  >
                    <Globe className="size-3" />
                    {label}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>

        <Tabs value={activeTab} className="w-full min-w-0">
          <TabsList className="w-full justify-start overflow-x-auto">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} asChild className="shrink-0">
                <Link to={tab.to} params={{ accountId }} search={{}} preload="intent">
                  {tab.label}
                </Link>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Outlet />
      </div>
    </PageContainer>
  );
}
