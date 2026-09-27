import { ArrowLeftIcon, TreeStructureIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useApiClient } from "@/app";
import { Button, EmptyState, PageHeader, Skeleton } from "@/components";
import { pageTitle } from "@/lib/page-title";
import { adminNodeDetailQueryOptions } from "@/lib/queries/nodes";
import { NodeMetadataForm } from "./-node-metadata-editor";

export const Route = createFileRoute("/_admin/_dashboard/admin/nodes/$nodeId_/edit")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle("Edit community · Admin", match.context.runtimeConfig) }],
  }),
  component: AdminNodeEdit,
});

function AdminNodeEdit() {
  const { nodeId } = Route.useParams();
  const apiClient = useApiClient();
  const nodeQuery = useQuery(adminNodeDetailQueryOptions(apiClient, nodeId));
  const node = nodeQuery.data?.summary.node;

  return (
    <div className="flex w-full max-w-2xl flex-col gap-10 sm:gap-12">
      <PageHeader
        label={
          <Link
            to="/admin/nodes/$nodeId"
            params={{ nodeId }}
            search={{}}
            className="inline-flex items-center gap-2 hover:text-foreground"
            data-testid="admin-back-link"
          >
            <ArrowLeftIcon className="size-4" />
            {node?.name ?? "Community"}
          </Link>
        }
        title="Edit community"
        description="Name, description and extra metadata."
        headerTestId="admin-node-edit.heading"
      />
      {nodeQuery.isLoading ? (
        <div className="flex flex-col gap-6" aria-busy="true">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : node ? (
        <NodeMetadataForm key={node.id} node={node} />
      ) : (
        <EmptyState
          icon={TreeStructureIcon}
          title="Couldn't load this community"
          description={nodeQuery.error?.message || "The requested community could not be loaded."}
          action={
            <Button variant="outline" nativeButton={false} render={<Link to="/admin/nodes" />}>
              Back to communities
            </Button>
          }
        />
      )}
    </div>
  );
}
