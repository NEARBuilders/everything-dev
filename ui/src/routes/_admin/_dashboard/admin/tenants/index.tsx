import {
  BuildingsIcon,
  CaretRightIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useApiClient } from "@/app";
import {
  Badge,
  Button,
  EmptyState,
  LocalDate,
  PageHeader,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components";
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
import { pageTitle } from "@/lib/page-title";
import { allNodesQueryOptions } from "@/lib/queries/nodes";
import { tenantsQueryOptions } from "@/lib/queries/tenants";
import { humanize, ListSkeleton, tenantStatusTone } from "../-admin-ui";
import { filterTenants } from "./-tenant-wizard";

type ApiClient = ReturnType<typeof useApiClient>;
type Tenant = Awaited<ReturnType<ApiClient["listTenants"]>>[number];

export const Route = createFileRoute("/_admin/_dashboard/admin/tenants/")({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(tenantsQueryOptions(context.apiClient)),
      context.queryClient.ensureQueryData(allNodesQueryOptions(context.apiClient)),
    ]);
  },
  head: ({ match }) => ({
    meta: [{ title: pageTitle("Sites · Admin", match.context.runtimeConfig) }],
  }),
  component: AdminTenants,
});

const STATUS_FILTERS = ["all", "active", "pending", "suspended"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: "All",
  active: "Active",
  pending: "Pending",
  suspended: "Suspended",
};

function AdminTenants() {
  const apiClient = useApiClient();
  const tenantsQuery = useQuery(tenantsQueryOptions(apiClient));
  const nodesQuery = useQuery(allNodesQueryOptions(apiClient));
  const isLoading = tenantsQuery.isLoading || nodesQuery.isLoading;
  const error = tenantsQuery.error ?? nodesQuery.error;
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");

  const slugByTenantId = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of nodesQuery.data ?? []) {
      if (node.tenantId && !map.has(node.tenantId)) map.set(node.tenantId, node.slug);
    }
    return map;
  }, [nodesQuery.data]);

  const tenants = useMemo(
    () => filterTenants(tenantsQuery.data ?? [], { status, query, slugByTenantId }),
    [tenantsQuery.data, status, query, slugByTenantId],
  );

  const columns = useMemo<DataTableColumnDef<Tenant>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium text-foreground">{row.original.name}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {slugByTenantId.get(row.original.id) ?? row.original.id.slice(0, 8)}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "accountId",
        header: "DAO account",
        cell: ({ row }) => (
          <span className="block max-w-64 truncate font-mono text-xs text-muted-foreground">
            {row.original.accountId}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={tenantStatusTone(row.original.status)}>
            {humanize(row.original.status)}
          </Badge>
        ),
      },
      {
        accessorKey: "createdAt",
        header: "Created",
        meta: { className: "hidden lg:table-cell" },

        cell: ({ row }) => (
          <span className="text-muted-foreground">
            <LocalDate value={row.original.createdAt} fallback="—" />
          </span>
        ),
      },
    ],
    [slugByTenantId],
  );

  const total = tenantsQuery.data?.length ?? 0;

  return (
    <>
      <PageHeader
        title="Sites"
        description="Each site is a community deployment owned by a DAO."
        actions={
          total > 0 ? (
            <Button
              nativeButton={false}
              render={<Link to="/admin/tenants/new" />}
              data-testid="admin-tenants-create"
            >
              <PlusIcon />
              New site
            </Button>
          ) : undefined
        }
        headerTestId="admin-tenants.heading"
      />

      <section className="flex flex-col gap-6">
        {total > 0 && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <Tabs
                value={status}
                onValueChange={(value) => {
                  const next = STATUS_FILTERS.find((filter) => filter === value);
                  if (next) setStatus(next);
                }}
              >
                <TabsList>
                  {STATUS_FILTERS.map((filter) => (
                    <TabsTrigger
                      key={filter}
                      value={filter}
                      data-testid={`admin-tenants-filter-${filter}`}
                    >
                      {STATUS_FILTER_LABELS[filter]}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
            <InputGroup className="sm:ml-auto sm:max-w-xs">
              <InputGroupAddon>
                <MagnifyingGlassIcon />
              </InputGroupAddon>
              <InputGroupInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name, slug or DAO"
                aria-label="Search sites"
                data-testid="admin-tenants-search"
              />
            </InputGroup>
          </div>
        )}

        {isLoading ? (
          <ListSkeleton />
        ) : error ? (
          <EmptyState
            icon={BuildingsIcon}
            title="Couldn't load sites"
            description={error.message || "Something went wrong while loading tenants."}
            action={
              <Button
                variant="outline"
                onClick={() => Promise.all([tenantsQuery.refetch(), nodesQuery.refetch()])}
              >
                Retry
              </Button>
            }
          />
        ) : total === 0 ? (
          <EmptyState
            icon={BuildingsIcon}
            title="No sites yet"
            description="Create the first community deployment."
            action={
              <Button nativeButton={false} render={<Link to="/admin/tenants/new" />}>
                <PlusIcon />
                New site
              </Button>
            }
          />
        ) : tenants.length === 0 ? (
          <EmptyState
            icon={BuildingsIcon}
            title="No matching sites"
            description="Try another status or search."
          />
        ) : (
          <>
            <div className="hidden md:block" data-testid="admin-tenants-table">
              <DataTable columns={columns} data={tenants} />
            </div>
            <ItemGroup className="md:hidden" data-testid="admin-tenants-rows">
              {tenants.map((tenant) => (
                <Item key={tenant.id} variant="outline">
                  <ItemContent className="min-w-0">
                    <ItemTitle className="max-w-full">
                      <span className="min-w-0 truncate">{tenant.name}</span>
                    </ItemTitle>
                    <ItemDescription>
                      <span className="font-mono break-all">{tenant.accountId}</span>
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Badge variant={tenantStatusTone(tenant.status)}>
                      {humanize(tenant.status)}
                    </Badge>
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
