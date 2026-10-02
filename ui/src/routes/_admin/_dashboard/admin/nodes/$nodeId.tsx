import { CaretRightIcon, PencilIcon, TreeStructureIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getActiveRuntime, useApiClient } from "@/app";
import {
  Button,
  EmptyState,
  InfoRow,
  NodeValidatorTable,
  PageHeader,
  SectionHeader,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components";
import { ProfileEditor } from "@/components/discovery/profile-editor";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { nodeKindLabel } from "@/lib/node-kind";
import { pageTitle } from "@/lib/page-title";
import { adminNodeDetailQueryOptions } from "@/lib/queries/nodes";
import { BackLink, RawJsonDisclosure, StatFigure, StatGrid } from "../-admin-ui";
import { NodeBindings } from "./-node-bindings";
import { NODE_DETAIL_TABS, type NodeDetailTab, parseNodeDetailTab } from "./-node-management";
import { NodeValidators } from "./-node-validators";

type ApiClient = ReturnType<typeof useApiClient>;
type NodeSummary = Awaited<ReturnType<ApiClient["getNodeSummary"]>>;

const TAB_LABELS: Record<NodeDetailTab, string> = {
  overview: "Overview",
  validators: "Validators",
  domains: "Domains",
  profile: "Profile",
};

export const Route = createFileRoute("/_admin/_dashboard/admin/nodes/$nodeId")({
  validateSearch: (search: Record<string, unknown>): { tab?: NodeDetailTab } => ({
    tab: parseNodeDetailTab(search.tab),
  }),
  head: ({ match }) => ({
    meta: [{ title: pageTitle("Community · Admin", match.context.runtimeConfig) }],
  }),
  component: AdminNodeDetail,
});

function AdminNodeDetail() {
  const { nodeId } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { runtimeConfig } = Route.useRouteContext();
  const apiClient = useApiClient();
  const nodeQuery = useQuery(adminNodeDetailQueryOptions(apiClient, nodeId));
  const activeTab = tab ?? "overview";

  if (nodeQuery.isLoading) {
    return (
      <div className="flex flex-col gap-6" aria-busy="true">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (nodeQuery.isError || !nodeQuery.data) {
    return (
      <EmptyState
        icon={TreeStructureIcon}
        title="Couldn't load this community"
        description={nodeQuery.error?.message || "The requested node could not be loaded."}
        action={
          <Button variant="outline" nativeButton={false} render={<Link to="/admin/nodes" />}>
            Back to nodes
          </Button>
        }
      />
    );
  }

  const { summary, sourceNode, parent } = nodeQuery.data;
  const { node } = summary;

  return (
    <>
      <PageHeader
        label={<BackLink to="/admin/nodes">Communities</BackLink>}
        title={node.name}
        subtitle={node.slug}
        description={
          parent ? (
            <>
              {nodeKindLabel(node.kind, "Node")} in{" "}
              <Link
                to="/admin/nodes/$nodeId"
                params={{ nodeId: parent.id }}
                search={{}}
                className="text-foreground hover:underline"
              >
                {parent.name}
              </Link>
            </>
          ) : (
            nodeKindLabel(node.kind, "Node")
          )
        }
        actions={
          <Button
            variant="outline"
            nativeButton={false}
            data-testid="admin-node-edit"
            render={<Link to="/admin/nodes/$nodeId/edit" params={{ nodeId: node.id }} />}
          >
            <PencilIcon /> Edit details
          </Button>
        }
        headerTestId="admin-node.heading"
      />

      <StatGrid>
        <StatFigure label="Direct children" value={summary.childrenCount} />
        <StatFigure label="Communities below" value={summary.subtreeNodeCount} />
        <StatFigure label="Validators" value={summary.validators.length} />
        <StatFigure label="Validators below" value={summary.subtreeValidatorCount} />
      </StatGrid>

      <div className="flex flex-col gap-6">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <Tabs
            value={activeTab}
            onValueChange={(value) => {
              const next = parseNodeDetailTab(value);
              navigate({ search: { tab: next === "overview" ? undefined : next } });
            }}
          >
            <TabsList variant="line">
              {NODE_DETAIL_TABS.map((value) => (
                <TabsTrigger key={value} value={value} data-testid={`admin-node-tab-${value}`}>
                  {TAB_LABELS[value]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {activeTab === "overview" && (
          <NodeOverview summary={summary} sourceName={sourceNode?.name} />
        )}
        {activeTab === "validators" && (
          <NodeValidators key={node.id} nodeId={node.id} validators={summary.validators} />
        )}
        {activeTab === "domains" &&
          (node.tenantId ? (
            <NodeBindings
              key={node.tenantId}
              tenantId={node.tenantId}
              gateway={getActiveRuntime(runtimeConfig)?.gatewayId ?? ""}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              This node is not attached to a tenant, so it has no domains.
            </p>
          ))}
        {activeTab === "profile" && <ProfileEditor nodeId={node.id} />}
      </div>
    </>
  );
}

function NodeOverview({ summary, sourceName }: { summary: NodeSummary; sourceName?: string }) {
  const { node } = summary;
  const resolvedElsewhere = summary.stakingValidators.sourceNodeId !== node.id;
  const description =
    typeof node.metadata.description === "string" ? node.metadata.description : null;

  return (
    <div className="flex flex-col gap-12">
      <section className="flex flex-col gap-6">
        <SectionHeader
          title="Staking"
          description={
            resolvedElsewhere
              ? `Stakes go to validators on ${sourceName ?? summary.stakingValidators.sourceNodeId}.`
              : "Stakes go to validators on this node or below it."
          }
        />
        {summary.stakingValidators.validators.length === 0 ? (
          <p className="text-sm text-muted-foreground">No validators to stake with yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border">
            <NodeValidatorTable validators={summary.stakingValidators.validators} />
          </div>
        )}
      </section>

      <section className="flex flex-col gap-6">
        <SectionHeader title="Children" />
        {summary.children.length === 0 ? (
          <p className="text-sm text-muted-foreground">No communities below this one.</p>
        ) : (
          <ItemGroup>
            {summary.children.map((child) => (
              <Item
                key={child.id}
                variant="outline"
                size="sm"
                render={
                  <Link to="/admin/nodes/$nodeId" params={{ nodeId: child.id }} search={{}} />
                }
              >
                <ItemContent className="min-w-0">
                  <ItemTitle className="max-w-full">
                    <span className="min-w-0 truncate">{child.name}</span>
                  </ItemTitle>
                  <ItemDescription>
                    {nodeKindLabel(child.kind, "Node")} ·{" "}
                    <span className="font-mono break-all">{child.slug}</span>
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <CaretRightIcon className="size-4 text-muted-foreground" />
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )}
      </section>

      <section className="flex flex-col gap-6">
        <SectionHeader title="Details" />
        {description && <p className="max-w-2xl text-base text-foreground">{description}</p>}
        <div className="flex flex-col">
          <InfoRow label="Community ID" value={node.id} mono />
          <InfoRow label="Site ID" value={node.tenantId ?? "None"} mono={!!node.tenantId} />
          <InfoRow label="Parent ID" value={node.parentId ?? "None"} mono={!!node.parentId} />
        </div>
        <RawJsonDisclosure value={node.metadata} label="metadata" />
      </section>
    </div>
  );
}
