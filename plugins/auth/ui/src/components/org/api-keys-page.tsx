import { KeyIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { createDataTableColumnHelper, DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { LocalDate } from "@/components/local-date";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { orgApiKeysQueryKey } from "@/lib/org-query-keys";
import { useAuthApi } from "@/lib/use-auth-api";
import {
  ApiKeyCreateDialog,
  type ApiKeyFormValues,
} from "@/routes/_authenticated/settings/-api-key-create-dialog";
import {
  ApiKeyRevealDialog,
  type CreatedApiKey,
} from "@/routes/_authenticated/settings/-api-key-reveal-dialog";
import { RowMenu } from "./row-menu";
import type { ApiKeyRow } from "./types";
import { useOrgWorkspace } from "./workspace-context";

const columnHelper = createDataTableColumnHelper<ApiKeyRow>();

export function OrgApiKeysPage() {
  const { org, adapter, canManage } = useOrgWorkspace();
  const api = useAuthApi();
  const queryClient = useQueryClient();
  const queryKey = orgApiKeysQueryKey(org.id);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiKeyRow | null>(null);

  const keys = useQuery({
    queryKey,
    queryFn: () => adapter.listApiKeys(org.id),
    enabled: canManage && adapter.capabilities.apiKeys,
  });

  const createKey = useMutation({
    mutationFn: (values: ApiKeyFormValues) =>
      api.createApiKey({
        configId: "org-keys",
        organizationId: org.id,
        name: values.name,
        ...(values.expiresIn !== undefined ? { expiresIn: values.expiresIn } : {}),
      }),
    onSuccess: async (key) => {
      setCreating(false);
      setCreated(key);
      toast.success("API key created");
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to create API key"),
  });

  const deleteKey = useMutation({
    mutationFn: (keyId: string) =>
      api.deleteApiKey({ id: keyId, organizationId: org.id, configId: "org-keys" }),
    onSuccess: async () => {
      toast.success("API key deleted");
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to delete API key"),
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor((key) => key.name ?? "Unnamed key", {
        id: "name",
        header: "Name",
        sortFn: "text",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.name ?? "Unnamed key"}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {row.original.start ?? row.original.prefix ?? ""}…
            </span>
          </div>
        ),
      }),
      columnHelper.accessor((key) => (key.lastRequest ? new Date(key.lastRequest).getTime() : 0), {
        id: "lastUsed",
        header: "Last used",
        sortFn: "alphanumeric",
        cell: ({ row }) =>
          row.original.lastRequest ? (
            <LocalDate value={row.original.lastRequest} format="relative" />
          ) : (
            <span className="text-muted-foreground">Never</span>
          ),
      }),
      columnHelper.accessor((key) => (key.expiresAt ? new Date(key.expiresAt).getTime() : 0), {
        id: "expires",
        header: "Expires",
        sortFn: "alphanumeric",
        cell: ({ row }) =>
          row.original.expiresAt ? (
            <LocalDate value={row.original.expiresAt} format="relative" />
          ) : (
            <span className="text-muted-foreground">Never</span>
          ),
      }),
      columnHelper.display({
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <RowMenu label="API key actions" testId={`org-api-key-menu-${row.original.id}`}>
              <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(row.original)}>
                <TrashIcon />
                Delete key
              </DropdownMenuItem>
            </RowMenu>
          </div>
        ),
      }),
    ],
    [],
  );

  if (!canManage || !adapter.capabilities.apiKeys) {
    return (
      <EmptyState
        icon={KeyIcon}
        title="API keys aren't available"
        description="Only organization owners and admins manage API keys."
      />
    );
  }

  return (
    <section className="flex flex-col gap-4" data-testid="org-api-keys">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)} data-testid="org-api-keys-create">
          <PlusIcon />
          Create key
        </Button>
      </div>
      {keys.isPending ? (
        <Skeleton className="h-32 w-full rounded-2xl" />
      ) : keys.isError ? (
        <EmptyState
          icon={KeyIcon}
          title="Couldn't load API keys"
          description={keys.error.message}
          action={
            <Button variant="outline" onClick={() => void keys.refetch()}>
              Try again
            </Button>
          }
        />
      ) : (
        <DataTable
          testId="org-api-keys-table"
          columns={columns}
          data={keys.data}
          getRowId={(key) => key.id}
          empty={
            <EmptyState
              icon={KeyIcon}
              title="No API keys"
              description="Create a key for scripts and agents that act for this organization."
            />
          }
        />
      )}
      <ApiKeyCreateDialog
        open={creating}
        onOpenChange={setCreating}
        onCreate={(values) => createKey.mutate(values)}
        isPending={createKey.isPending}
      />
      <ApiKeyRevealDialog apiKey={created} onDismiss={() => setCreated(null)} />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={`Delete ${deleteTarget?.name ?? "this key"}?`}
        description="Anything using this key stops working immediately."
        confirmLabel="Delete key"
        variant="destructive"
        isPending={deleteKey.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteKey.mutate(deleteTarget.id, { onSettled: () => setDeleteTarget(null) });
        }}
      />
    </section>
  );
}
