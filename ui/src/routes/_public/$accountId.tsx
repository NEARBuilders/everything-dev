import { ArrowUpRightIcon, CompassIcon, UserIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { getSocialImageMeta } from "everything-dev/ui/metadata";
import { useAuthClient } from "@/app";
import { Avatar, AvatarFallback, AvatarImage, Button, PageContainer } from "@/components";
import { getNearInitials, resolveNearImageUrl } from "@/lib/near-profile";

export const Route = createFileRoute("/_public/$accountId")({
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
    const title = `${accountId} | CityNode`;
    const description = `${accountId}'s public profile on CityNode.`;

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

function AccountProfileLayout() {
  const { accountId } = Route.useLoaderData();
  const authClient = useAuthClient();

  const { data: profile, isPending } = useQuery({
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
  const linktree = profile?.linktree
    ? Object.entries(profile.linktree).filter(([, url]) => Boolean(url))
    : [];
  const hasProfile = !!(profile?.name || profile?.description || avatarUrl || linktree.length);

  return (
    <PageContainer variant="narrow">
      <header className="flex flex-col gap-6" data-testid="account.profile">
        {backgroundUrl ? (
          <img
            src={backgroundUrl}
            alt=""
            className="h-32 w-full rounded-3xl bg-muted object-cover sm:h-44"
          />
        ) : null}
        <div className="flex min-w-0 items-center gap-4 sm:gap-5">
          <Avatar className="size-16 shrink-0 sm:size-20">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
            <AvatarFallback>{initials || <UserIcon className="size-8" />}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-2xl font-semibold wrap-anywhere text-foreground sm:text-3xl">
              {displayName}
            </h1>
            {profile?.name && (
              <p className="truncate font-mono text-sm text-muted-foreground">{accountId}</p>
            )}
          </div>
        </div>
        {profile?.description && (
          <p className="max-w-2xl text-base text-muted-foreground">{profile.description}</p>
        )}
        {linktree.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {linktree.map(([label, url]) => (
              <Button
                key={label}
                variant="outline"
                size="sm"
                nativeButton={false}
                render={(props) => (
                  <a {...props} href={url} target="_blank" rel="noopener noreferrer" />
                )}
              >
                {label}
                <ArrowUpRightIcon />
              </Button>
            ))}
          </div>
        )}
      </header>

      {!isPending && !hasProfile && (
        <section
          data-testid="account.no-profile"
          className="flex flex-col items-start gap-4 rounded-3xl bg-muted p-6 sm:p-8"
        >
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-medium text-foreground">No profile yet</h2>
            <p className="text-sm text-muted-foreground">
              This account hasn’t set up a NEAR profile.
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Button variant="outline" nativeButton={false} render={<Link to="/explore" />}>
              <CompassIcon />
              Explore communities
            </Button>
            <Button
              variant="ghost"
              nativeButton={false}
              render={(props) => (
                <a
                  {...props}
                  href={`https://nearblocks.io/address/${encodeURIComponent(accountId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              )}
            >
              View on NearBlocks
              <ArrowUpRightIcon />
            </Button>
          </div>
        </section>
      )}

      <Outlet />
    </PageContainer>
  );
}
