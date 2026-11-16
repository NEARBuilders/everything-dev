import { BankIcon, ProhibitIcon, TrashIcon } from "@phosphor-icons/react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, stripSearchParams } from "@tanstack/react-router";
import { requireAdmin } from "everything-dev/ui/auth";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { createDataTableColumnHelper, DataTable, TablePagination } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { LocalDate } from "@/components/local-date";
import { OrgAvatar, roleLabel } from "@/components/org/org-avatar";
import { RowMenu } from "@/components/org/row-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { AuthApiClient } from "@/lib/api";
import { adminOrganizationsQueryKey, organizationsQueryKey } from "@/lib/org-query-keys";
import { useAuthApi } from "@/lib/use-auth-api";

const PAGE_SIZE = 20;

const searchSchema = z.object({
  q: z.string().default("").catch(""),
  status: z.enum(["all", "active", "pending", "rejected"]).default("all").catch("all"),
  personal: z.enum(["all", "only", "hide"]).default("all").catch("all"),
  offset: z.number().int().nonnegative().default(0).catch(0),
});

type AdminOrgSearch = z.infer<typeof searchSchema>;

type AdminOrgRow = Awaited<
  ReturnType<AuthApiClient["adminListOrganizations"]>
>["organizations"][number];

const DEFAULT_SEARCH: AdminOrgSearch = { q: "", status: "all", personal: "all", offset: 0 };

function adminOrganizationsQueryOptions(api: AuthApiClient, search: AdminOrgSearch) {
  return {
    queryKey: [...adminOrganizationsQueryKey, search] as const,
    queryFn: () =>
      api.adminListOrganizations({
        ...(search.q.trim() ? { search: search.q.trim() } : {}),
        ...(search.status !== "all" ? { status: search.status } : {}),
        ...(search.personal !== "all" ? { personal: search.personal === "only" } : {}),
        limit: PAGE_SIZE,
        offset: search.offset,
      }),
    placeholderData: keepPreviousData,
  };
}

export const Route = createFileRoute("/_authenticated/admin/orgs/")({
  head: () => ({
    meta: [
      { title: "Organizations · Admin" },
      { name: "description", content: "Platform-wide organization management." },
    ],
  }),
  validateSearch: searchSchema,
  search: { middlewares: [stripSearchParams(DEFAULT_SEARCH)] },
  beforeLoad: requireAdmin,
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    await context.queryClient.prefetchQuery(
      adminOrganizationsQueryOptions(context.apiClient.auth, deps),
    );
  },
  component: AdminOrganizations,
});

const STATUS_ITEMS = [
  { label: "Any status", value: "all" },
  { label: "Active", value: "active" },
  { label: "Pending", value: "pending" },
  { label: "Rejected", value: "rejected" },
];

const PERSONAL_ITEMS = [
  { label: "All organizations", value: "all" },
  { label: "Personal only", value: "only" },
  { label: "Hide personal", value: "hide" },
];

const STATUS_VARIANT = {
  active: "success",
  pending: "secondary",
  rejected: "destructive",
} as const;

const columnHelper = createDataTableColumnHelper<AdminOrgRow>();

function AdminOrganizations() {
  const api = useAuthApi();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [queryText, setQueryText] = useState(search.q);
  const [deleteTarget, setDeleteTarget] = useState<AdminOrgRow | null>(null);

  useEffect(() => {
    if (queryText === search.q) return;
    const timer = setTimeout(() => {
      void navigate({
        search: (prev: AdminOrgSearch) => ({ ...prev, q: queryText, offset: 0 }),
        replace: true,
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [queryText, search.q, navigate]);

  const orgsQuery = useQuery(adminOrganizationsQueryOptions(api, search));
  const organizations = orgsQuery.data?.organizations ?? [];
  const total = orgsQuery.data?.total ?? 0;

  const deleteMutation = useMutation({
    mutationFn: (organizationId: string) => api.adminDeleteOrganization({ organizationId }),
    onSuccess: async () => {
      toast.success("Organization deleted");
      await queryClient.invalidateQueries({ queryKey: adminOrganizationsQueryKey });
      await queryClient.invalidateQueries({ queryKey: organizationsQueryKey });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to delete organization"),
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor((org) => `${org.name} ${org.slug}`, {
        id: "organization",
        header: "Organization",
        sortFn: "text",
        cell: ({ row }) => {
          const org = row.original;
          const isPersonal = org.metadata?.isPersonal === true;
          return (
            <Link
              to="/admin/orgs/$orgId"
              params={{ orgId: org.id }}
              className="flex min-w-0 items-center gap-3 outline-none hover:underline focus-visible:underline"
              data-testid={`admin-orgs.link-${org.slug}`}
            >
              <OrgAvatar name={org.name} logo={org.logo} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium text-foreground">
                  {org.name}
                  {isPersonal && (
                    <Badge variant="outline" className="ml-2">
                      Personal
                    </Badge>
                  )}
                </span>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  @{org.slug}
                </span>
              </span>
            </Link>
          );
        },
      }),
      columnHelper.accessor("status", {
        header: "Status",
        sortFn: "text",
        cell: ({ row }) => (
          <Badge variant={STATUS_VARIANT[row.original.status]}>
            {roleLabel(row.original.status)}
          </Badge>
        ),
      }),
      columnHelper.accessor("memberCount", {
        header: "Members",
        sortFn: "alphanumeric",
        cell: ({ row }) => <span className="tabular-nums">{row.original.memberCount}</span>,
      }),
      columnHelper.accessor("teamCount", {
        header: "Teams",
        sortFn: "alphanumeric",
        cell: ({ row }) => <span className="tabular-nums">{row.original.teamCount}</span>,
      }),
      columnHelper.accessor((org) => new Date(org.createdAt).getTime(), {
        id: "created",
        header: "Created",
        sortFn: "alphanumeric",
        cell: ({ row }) => <LocalDate value={row.original.createdAt} format="relative" />,
      }),
      columnHelper.display({
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <RowMenu
              label={`Actions for ${row.original.name}`}
              testId={`admin-orgs.menu-${row.original.slug}`}
            >
              <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(row.original)}>
                <TrashIcon />
                Delete organization
              </DropdownMenuItem>
            </RowMenu>
          </div>
        ),
      }),
    ],
    [],
  );

  return (
    <PageContainer variant="wide">
      <PageHeader
        title="Organizations"
        description="Every organization on this platform. Review, approve, and manage members and teams."
        headerTestId="admin-orgs.heading"
      />

      <div className="flex flex-wrap items-center gap-2" data-testid="admin-orgs.filters">
        <Input
          value={queryText}
          onChange={(event) => setQueryText(event.target.value)}
          placeholder="Search by name, handle, or id"
          className="max-w-xs"
          data-testid="admin-orgs.search-input"
        />
        <Select
          value={search.status}
          items={STATUS_ITEMS}
          onValueChange={(value) => {
            if (
              value === "all" ||
              value === "active" ||
              value === "pending" ||
              value === "rejected"
            ) {
              void navigate({
                search: (prev: AdminOrgSearch) => ({ ...prev, status: value, offset: 0 }),
              });
            }
          }}
        >
          <SelectTrigger
            className="min-w-36"
            aria-label="Status"
            data-testid="admin-orgs.status-select"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={search.personal}
          items={PERSONAL_ITEMS}
          onValueChange={(value) => {
            if (value === "all" || value === "only" || value === "hide") {
              void navigate({
                search: (prev: AdminOrgSearch) => ({ ...prev, personal: value, offset: 0 }),
              });
            }
          }}
        >
          <SelectTrigger
            className="min-w-44"
            aria-label="Personal organizations"
            data-testid="admin-orgs.personal-select"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERSONAL_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {orgsQuery.isPending ? (
        <div className="flex flex-col gap-3" data-testid="admin-orgs.loading">
          <Skeleton className="h-14 w-full rounded-2xl" />
          <Skeleton className="h-14 w-full rounded-2xl" />
          <Skeleton className="h-14 w-full rounded-2xl" />
        </div>
      ) : orgsQuery.isError ? (
        <EmptyState
          icon={ProhibitIcon}
          title="Couldn't load organizations"
          description={orgsQuery.error.message}
          action={
            <Button variant="outline" onClick={() => void orgsQuery.refetch()}>
              Try again
            </Button>
          }
        />
      ) : (
        <DataTable
          testId="admin-orgs.table"
          columns={columns}
          data={organizations}
          getRowId={(org) => org.id}
          empty={
            <EmptyState
              icon={BankIcon}
              title="No organizations found"
              description="Nothing matches these filters."
            />
          }
        />
      )}

      <TablePagination
        testId="admin-orgs.pagination"
        offset={search.offset}
        pageSize={PAGE_SIZE}
        total={total}
        onOffsetChange={(offset) =>
          void navigate({ search: (prev: AdminOrgSearch) => ({ ...prev, offset }) })
        }
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={`Delete ${deleteTarget?.name ?? "organization"}?`}
        description="Its members, teams and invitations are removed. This cannot be undone."
        confirmLabel="Delete organization"
        variant="destructive"
        isPending={deleteMutation.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteMutation.mutate(deleteTarget.id, { onSettled: () => setDeleteTarget(null) });
        }}
      />
    </PageContainer>
  );
}
