import { CubeIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { useApiClient } from "@/app";
import { Button, EmptyState, PageContainer } from "@/components";
import { Skeleton } from "@/components/ui/skeleton";
import { pageTitle } from "@/lib/page-title";
import { invalidateThingAfterDelete } from "./-thing-cache";
import { ThingBackLink, ThingDetailsView } from "./-thing-details-view";

export const Route = createFileRoute("/_authenticated/_dashboard/things/$thingId")({
  head: ({ params, match }) => ({
    meta: [
      { title: pageTitle(params.thingId, match.context.runtimeConfig) },
      { name: "description", content: `Detail view for thing ${params.thingId}.` },
    ],
  }),
  component: ThingDetailsPage,
});

function ThingDetailsPage() {
  const { thingId } = Route.useParams();
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const canGoBack = router.history.canGoBack?.() ?? false;
  const { session } = Route.useRouteContext();
  const isAdmin = session?.user?.role === "admin";

  const thingQuery = useQuery({
    queryKey: ["thing", thingId],
    queryFn: () => apiClient.template.getThing({ thingId }),
    retry: false,
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.template.deleteThing({ thingId }),
    onSuccess: async () => {
      toast.success("Thing deleted");
      try {
        await invalidateThingAfterDelete(queryClient, thingId);
      } catch {
        toast.warning("Thing deleted, but the Things list could not refresh.");
      }
      void router.navigate({ to: "/things" });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const thing = thingQuery.data;

  if (thingQuery.isPending) {
    return (
      <PageContainer variant="default">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      </PageContainer>
    );
  }

  if (!thing) {
    return (
      <PageContainer variant="default">
        <ThingBackLink canGoBack={canGoBack} onBack={() => router.history.back()} />
        <EmptyState
          icon={CubeIcon}
          title="Thing not found"
          description={
            thingQuery.error
              ? `Couldn't load ${thingId}: ${thingQuery.error.message}`
              : `No thing exists for ${thingId}.`
          }
          action={
            <Button nativeButton={false} render={<Link to="/things" />}>
              Back to things
            </Button>
          }
        />
      </PageContainer>
    );
  }

  return (
    <ThingDetailsView
      canGoBack={canGoBack}
      isAdmin={isAdmin}
      isDeletePending={deleteMutation.isPending}
      thing={thing}
      thingId={thingId}
      onBack={() => router.history.back()}
      onDelete={() => deleteMutation.mutate()}
    />
  );
}
