import { CaretRightIcon, MagnifyingGlassIcon, TreeStructureIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useApiClient } from "@/app";
import { Badge, Button, EmptyState, PageHeader, Tabs, TabsList, TabsTrigger } from "@/components";
import { DataTable, type DataTableColumnDef } from "@/components/data-table";
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
import { geoNodeKinds, nodeKindLabel } from "@/lib/node-kind";
import { pageTitle } from "@/lib/page-title";
import {
  type AdminNodeListKind,
  type AdminNodeListRow,
  type AdminNodeListScope,
  adminNodeListQueryOptions,
} from "@/lib/queries/nodes";
import { humanize, ListSkeleton, tenantStatusTone } from "../-admin-ui";
import { filterNodeRows } from "./-node-management";

type AdminNodeSearch = {
  scope?: AdminNodeListScope;
  kind?: AdminNodeListKind;
};

const NODE_KIND_VALUES = ["all", ...geoNodeKinds] as const satisfies readonly AdminNodeListKind[];

const NODE_KIND_LABELS = {
  all: "All kinds",
  ...Object.fromEntries(geoNodeKinds.map((kind) => [kind, nodeKindLabel(kind)])),
} as Record<AdminNodeListKind, string>;

function parseScope(value: unknown): AdminNodeListScope | undefined {
  return value === "roots" || value === "all" ? value : undefined;
}

function parseKind(value: unknown): AdminNodeListKind | undefined {
  return typeof value === "string" && NODE_KIND_VALUES.some((kind) => kind === value)
    ? (value as AdminNodeListKind)
    : undefined;
}

export const Route = createFileRoute("/_admin/_dashboard/admin/nodes/")({
  validateSearch: (search: Record<string, unknown>): AdminNodeSearch => ({
    scope: parseScope(search.scope),
    kind: parseKind(search.kind),
  }),
  loaderDeps: ({ search }) => ({
    scope: search.scope ?? "roots",
    kind: search.kind ?? "all",
  }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(
      adminNodeListQueryOptions(context.apiClient, deps.scope, deps.kind),
    ),
  head: ({ match }) => ({
    meta: [{ title: pageTitle("Communities · Admin", match.context.runtimeConfig) }],
  }),
  component: AdminNodes,
});

function AdminNodes() {
  const apiClient = useApiClient();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const scope = search.scope ?? "roots";
  const kind = search.kind ?? "all";
  const nodesQuery = useQuery(adminNodeListQueryOptions(apiClient, scope, kind));
  const [query, setQuery] = useState("");

  const columns = useMemo<DataTableColumnDef<AdminNodeListRow>[]>(
    () => [
      {
        id: "name",
        accessorFn: (row) => row.node.name,
        header: "Name",
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            <Link
              to="/admin/nodes/$nodeId"
              params={{ nodeId: row.original.node.id }}
              className="font-medium text-foreground hover:underline"
            >
              {row.original.node.name}
            </Link>
            <span className="font-mono text-xs text-muted-foreground">
              {row.original.node.slug}
            </span>
          </div>
        ),
      },
      {
        id: "kind",
        accessorFn: (row) => row.node.kind,
        header: "Kind",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {nodeKindLabel(row.original.node.kind, "—")}
          </span>
        ),
      },
      {
        id: "parent",
        accessorFn: (row) => row.parent?.name ?? "",
        header: "Parent",
        meta: { className: "hidden lg:table-cell" },

        cell: ({ row }) =>
          row.original.parent ? (
            <Link
              to="/admin/nodes/$nodeId"
              params={{ nodeId: row.original.parent.id }}
              className="text-foreground hover:underline"
            >
              {row.original.parent.name}
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "status",
        header: "Tenant",
        cell: ({ row }) => (
          <Badge variant={tenantStatusTone(row.original.status)}>
            {humanize(row.original.status)}
          </Badge>
        ),
      },
      {
        accessorKey: "validatorCount",
        header: "Validators",
        cell: ({ row }) => <span className="tabular-nums">{row.original.validatorCount}</span>,
      },
      {
        accessorKey: "childrenCount",
        header: "Children",
        meta: { className: "hidden lg:table-cell" },

        cell: ({ row }) => <span className="tabular-nums">{row.original.childrenCount}</span>,
      },
    ],
    [],
  );

  const visibleNodes = useMemo(
    () => filterNodeRows(nodesQuery.data ?? [], query),
    [nodesQuery.data, query],
  );

  return (
    <>
      <PageHeader
        title="Communities"
        description="Countries, states and cities in the community tree."
        headerTestId="admin-nodes.heading"
      />

      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Tabs
            value={scope}
            onValueChange={(value) =>
              navigate({
                search: (previous) => ({
                  ...previous,
                  scope: value === "all" ? "all" : undefined,
                }),
              })
            }
          >
            <TabsList>
              <TabsTrigger value="roots" data-testid="admin-nodes-scope-roots">
                Top level
              </TabsTrigger>
              <TabsTrigger value="all" data-testid="admin-nodes-scope-all">
                All nodes
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Select
            value={kind}
            items={NODE_KIND_VALUES.map((value) => ({ label: NODE_KIND_LABELS[value], value }))}
            onValueChange={(value) => {
              const nextKind = parseKind(value);
              if (!nextKind) return;
              navigate({
                search: (previous) => ({
                  ...previous,
                  kind: nextKind === "all" ? undefined : nextKind,
                }),
              });
            }}
          >
            <SelectTrigger
              aria-label="Filter communities by kind"
              className="w-full sm:w-auto"
              data-testid="admin-nodes-kind"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NODE_KIND_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {NODE_KIND_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <InputGroup className="sm:ml-auto sm:max-w-xs">
            <InputGroupAddon>
              <MagnifyingGlassIcon />
            </InputGroupAddon>
            <InputGroupInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name or slug"
              aria-label="Search communities"
              data-testid="admin-nodes-search"
            />
          </InputGroup>
        </div>

        {nodesQuery.isLoading ? (
          <ListSkeleton />
        ) : nodesQuery.isError ? (
          <EmptyState
            icon={TreeStructureIcon}
            title="Couldn't load communities"
            description={nodesQuery.error.message || "Something went wrong while loading nodes."}
            action={
              <Button variant="outline" onClick={() => nodesQuery.refetch()}>
                Retry
              </Button>
            }
          />
        ) : !visibleNodes.length ? (
          <EmptyState
            icon={TreeStructureIcon}
            title="No matching communities"
            description="Try all communities, another kind or a different search."
          />
        ) : (
          <>
            <div className="hidden md:block" data-testid="admin-nodes-table">
              <DataTable columns={columns} data={visibleNodes} />
            </div>
            <ItemGroup className="md:hidden" data-testid="admin-nodes-rows">
              {visibleNodes.map((row) => (
                <Item
                  key={row.node.id}
                  variant="outline"
                  render={<Link to="/admin/nodes/$nodeId" params={{ nodeId: row.node.id }} />}
                >
                  <ItemContent className="min-w-0">
                    <ItemTitle className="max-w-full">
                      <span className="min-w-0 truncate">{row.node.name}</span>
                    </ItemTitle>
                    <ItemDescription>
                      {nodeKindLabel(row.node.kind, "Node")}
                      {row.parent ? ` in ${row.parent.name}` : ""} · {row.validatorCount}{" "}
                      {row.validatorCount === 1 ? "validator" : "validators"}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Badge variant={tenantStatusTone(row.status)}>{humanize(row.status)}</Badge>
                    <CaretRightIcon className="size-4 text-muted-foreground" />
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          </>
        )}
      </section>
    </>
  );
}
