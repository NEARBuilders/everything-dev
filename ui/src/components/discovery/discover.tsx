import {
  ArrowUpRightIcon,
  CheckCircleIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  SparkleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { type ApiClient, useApiClient } from "@/app";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { LocalDate } from "@/components/local-date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CurateReports } from "./curate-reports";
import { CurateTeam } from "./curate-team";
import { DiscoveryAction } from "./discovery-action";
import { DiscoveryMetrics } from "./discovery-measurement";

type Studio = Awaited<ReturnType<ApiClient["getDiscoveryStudio"]>>;
type StudioNode = Studio["nodes"][number];

const COMMUNITY_FILTERS = [
  { label: "All communities", value: "all" },
  { label: "Needs attention", value: "attention" },
  { label: "Featured", value: "featured" },
];

export function needsAttention(node: Pick<StudioNode, "summary" | "channels" | "active">) {
  return !node.summary || !node.channels.length || !node.active;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-3xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export function Discover() {
  const api = useApiClient();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const studio = useQuery({
    queryKey: ["discover"],
    queryFn: () => api.getDiscoveryStudio(),
    retry: false,
  });
  if (studio.isPending)
    return (
      <div className="flex flex-col gap-10">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-5 w-full max-w-sm" />
        </div>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          {["a", "b", "c", "d"].map((key) => (
            <Skeleton key={key} className="h-16 w-full" />
          ))}
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full max-w-md" />
          {["a", "b", "c"].map((key) => (
            <Skeleton key={key} className="h-16 w-full" />
          ))}
        </div>
      </div>
    );
  if (studio.isError)
    return (
      <EmptyState
        icon={ShieldCheckIcon}
        title="Directory is for curators"
        description="Ask a site admin for curator access. To edit your own community, use My community."
        action={
          <>
            <Button nativeButton={false} render={<Link to="/dashboard/node" />}>
              Go to My community
            </Button>
            <Button variant="ghost" onClick={() => studio.refetch()}>
              Try again
            </Button>
          </>
        }
      />
    );
  const data = studio.data;
  const selected = data.nodes.find((node) => node.nodeId === selectedId);
  const rows = data.nodes.filter(
    (node) =>
      `${node.name} ${node.location} ${node.region}`.toLowerCase().includes(query.toLowerCase()) &&
      (filter !== "attention" || needsAttention(node)) &&
      (filter !== "featured" || node.featured),
  );
  const attentionCount = data.nodes.filter(needsAttention).length;
  const featuredCount = data.nodes.filter((node) => node.featured).length;
  const reportsOpen = data.reports.filter((report) => !report.resolved).length;

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        headerTestId="curate.heading"
        title="Directory"
        description="Feature good communities and keep Explore accurate."
        actions={
          <Button variant="outline" nativeButton={false} render={<Link to="/explore" />}>
            Open Explore
            <ArrowUpRightIcon />
          </Button>
        }
      />
      <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Stat label="Communities" value={data.nodes.length} />
        <Stat label="Need attention" value={attentionCount} />
        <Stat label="Featured" value={featuredCount} />
        {data.isAdmin && <Stat label="Open reports" value={reportsOpen} />}
      </dl>
      <Tabs defaultValue="communities">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList variant="line">
            <TabsTrigger value="communities" data-testid="studio-tab-communities">
              Communities
            </TabsTrigger>
            {data.isAdmin && (
              <TabsTrigger value="reports" data-testid="studio-tab-reports">
                Reports
                {reportsOpen > 0 && <Badge variant="warning">{reportsOpen}</Badge>}
              </TabsTrigger>
            )}
            <TabsTrigger value="engagement" data-testid="studio-tab-engagement">
              Engagement
            </TabsTrigger>
            {data.isAdmin && (
              <TabsTrigger value="access" data-testid="studio-tab-access">
                Team
              </TabsTrigger>
            )}
          </TabsList>
        </div>
        <TabsContent value="communities" className="flex flex-col gap-4 pt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <InputGroup className="w-full sm:max-w-xs">
              <InputGroupAddon>
                <MagnifyingGlassIcon />
              </InputGroupAddon>
              <InputGroupInput
                aria-label="Search communities"
                placeholder="Search communities"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </InputGroup>
            <Select
              items={COMMUNITY_FILTERS}
              value={filter}
              onValueChange={(value) => setFilter(value ?? "all")}
            >
              <SelectTrigger aria-label="Community filter" className="w-full sm:w-auto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMUNITY_FILTERS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {rows.length === 0 ? (
            <EmptyState
              icon={MagnifyingGlassIcon}
              title="No communities match"
              description="Try another search or filter."
            />
          ) : (
            <ItemGroup data-testid="curate-communities">
              {rows.map((node) => (
                <Item key={node.nodeId} variant="outline" size="sm">
                  <ItemContent>
                    <ItemTitle className="flex-wrap">
                      <span className="min-w-0 truncate">{node.name}</span>
                      {node.featured && (
                        <Badge variant="success">
                          <SparkleIcon />
                          Featured
                        </Badge>
                      )}
                      {needsAttention(node) && <Badge variant="warning">Needs attention</Badge>}
                    </ItemTitle>
                    <ItemDescription>
                      {[node.location, node.region].filter(Boolean).join(" · ") || "No location"}
                      {" · "}
                      {node.active ? "Active" : "Quiet lately"}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid={`studio-manage-${node.nodeId}`}
                      onClick={() => setSelectedId(node.nodeId)}
                    >
                      Manage
                    </Button>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          )}
        </TabsContent>
        <TabsContent value="engagement" className="pt-6">
          <DiscoveryMetrics nodes={data.nodes} />
        </TabsContent>
        {data.isAdmin && (
          <TabsContent value="reports" className="pt-6">
            <CurateReports studio={data} />
          </TabsContent>
        )}
        {data.isAdmin && (
          <TabsContent value="access" className="pt-6">
            <CurateTeam curators={data.curators} />
          </TabsContent>
        )}
      </Tabs>
      <Sheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <SheetContent
          side="right"
          className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
        >
          {selected && <CommunitySheetBody node={selected} isAdmin={data.isAdmin} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function CommunitySheetBody({ node, isAdmin }: { node: StudioNode; isAdmin: boolean }) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [confirmUnfeature, setConfirmUnfeature] = useState(false);
  const unfeature = useMutation({
    mutationFn: () =>
      api.featureDiscoveryNode({
        nodeId: node.nodeId,
        label: "Expired",
        expiresAt: new Date(0).toISOString(),
      }),
    onSuccess: async () => {
      toast.success(`${node.name} is no longer featured`);
      setConfirmUnfeature(false);
      await queryClient.invalidateQueries({
        predicate: (q) => String(q.queryKey[0]).startsWith("discover"),
      });
    },
    onError: (error: Error) => toast.error(error.message || "Couldn't update the feature."),
  });
  const checks = [
    { ready: !!node.summary, label: node.summary ? "Has a description" : "No description yet" },
    {
      ready: node.latitude !== null,
      label: node.latitude !== null ? "On the map" : "Not on the map",
    },
    {
      ready: !!node.channels.length,
      label: node.channels.length ? "Has a join link" : "No join link yet",
    },
    { ready: node.active, label: node.activityReason },
  ];
  return (
    <>
      <SheetHeader className="px-6 pt-8 pr-16">
        <SheetTitle>{node.name}</SheetTitle>
        <SheetDescription>
          {[node.location, node.region].filter(Boolean).join(" · ") || "No location"}
        </SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-10 px-6 pb-8">
        <section className="flex flex-col gap-3">
          <h3 className="text-lg font-medium">What visitors see</h3>
          <ul className="flex flex-col gap-2">
            {checks.map(({ ready, label }) => (
              <li key={label} className="flex items-center gap-2.5 text-sm">
                {ready ? (
                  <CheckCircleIcon className="size-4 shrink-0 text-success" />
                ) : (
                  <WarningCircleIcon className="size-4 shrink-0 text-warning" />
                )}
                {label}
              </li>
            ))}
          </ul>
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              nativeButton={false}
              render={
                <Link
                  to="/nodes/$nodeId/content"
                  params={{ nodeId: node.nodeId }}
                  search={{ tab: "profile" }}
                />
              }
            >
              Edit events & profile
            </Button>
          )}
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-medium">Feature on Explore</h3>
            {node.featured && (
              <Button variant="ghost" size="sm" onClick={() => setConfirmUnfeature(true)}>
                Stop featuring
              </Button>
            )}
          </div>
          {node.featured && (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="success">
                <SparkleIcon />
                Featured
              </Badge>
              {node.featured}
            </p>
          )}
          <DiscoveryAction
            testId={`discovery-feature-${node.nodeId}`}
            label={node.featured ? "Update feature" : "Feature community"}
            successMessage={`${node.name} is featured`}
            run={(data) =>
              api.featureDiscoveryNode({
                nodeId: node.nodeId,
                label: String(data.get("label")),
                expiresAt: new Date(String(data.get("expires"))).toISOString(),
              })
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`feature-label-${node.nodeId}`}>Label</FieldLabel>
                <Input
                  id={`feature-label-${node.nodeId}`}
                  name="label"
                  required
                  maxLength={80}
                  placeholder="New this month"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`feature-expires-${node.nodeId}`}>Until</FieldLabel>
                <Input
                  id={`feature-expires-${node.nodeId}`}
                  name="expires"
                  type="datetime-local"
                  required
                />
              </Field>
            </div>
          </DiscoveryAction>
        </section>

        <DiscoveryHistory nodeId={node.nodeId} />
      </div>
      <ConfirmDialog
        open={confirmUnfeature}
        onOpenChange={setConfirmUnfeature}
        title={`Stop featuring ${node.name}?`}
        description="It stays on Explore without the featured label."
        confirmLabel="Stop featuring"
        cancelLabel="Cancel"
        variant="destructive"
        isPending={unfeature.isPending}
        onConfirm={() => unfeature.mutate()}
      />
    </>
  );
}

export function DiscoveryHistory({ nodeId }: { nodeId: string }) {
  const api = useApiClient();
  const history = useQuery({
    queryKey: ["discovery-history", nodeId],
    queryFn: () => api.getDiscoveryHistory({ nodeId }),
    retry: false,
  });
  if (!history.data?.length) return null;
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="Recent changes" />
      <ul className="flex flex-col divide-y divide-border text-sm">
        {history.data.slice(0, 8).map((entry) => (
          <li key={entry.id} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0">{historyLabel(entry.action)}</span>
            <span className="shrink-0 text-muted-foreground">
              <LocalDate value={entry.recordedAt} format="relative" />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function historyLabel(action: string) {
  if (action.startsWith("Luma connected")) return "Connected a Luma calendar";
  if (action === "Luma calendar disconnected") return "Disconnected Luma";
  if (action === "moderation: unpublish") return "Hidden from Explore";
  if (action === "profile published") return "Published this community";
  if (action === "profile saved as draft") return "Saved as a draft";
  if (action.endsWith(" published")) return "Published";
  if (action.endsWith(" draft")) return "Saved a draft";
  if (action.endsWith(" cancelled")) return "Marked as cancelled";
  return "Updated";
}
