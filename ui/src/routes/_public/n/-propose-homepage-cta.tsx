import { HouseIcon } from "@phosphor-icons/react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Organization } from "@/app";
import { sessionQueryOptions, useApiClient, useAuthClient } from "@/app";
import { Button } from "@/components";
import { tenantByOrgQueryOptions } from "@/lib/queries/tenants";

export function ProposeHomepageCta({ tenantId }: { tenantId: string | null }) {
  const auth = useAuthClient();
  const apiClient = useApiClient();
  const { data: session } = useQuery(sessionQueryOptions(auth));
  const signedIn = !!session?.user && !session.user.isAnonymous;
  const enabled = signedIn && !!tenantId;

  const { data: organizations = [] } = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => {
      const { data } = await auth.organization.list();
      return (data || []) as Organization[];
    },
    staleTime: 30 * 1000,
    enabled,
  });

  const tenants = useQueries({
    queries: organizations.map((org) => ({
      ...tenantByOrgQueryOptions(apiClient, org.id),
      enabled,
    })),
  });

  if (!enabled) return null;

  const owningOrg = organizations.find((_, index) => {
    const tenant = tenants[index]?.data;
    return tenant?.id === tenantId && tenant.ownerKind === "dao";
  });

  if (!owningOrg) return null;

  return (
    <Button
      variant="outline"
      nativeButton={false}
      render={
        <Link
          to="/orgs/$slug"
          params={{ slug: owningOrg.slug }}
          search={{ tab: "homepage" }}
          data-testid="node-page.propose-homepage"
        />
      }
    >
      <HouseIcon />
      Propose homepage change
    </Button>
  );
}
