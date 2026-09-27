import { GlobeIcon, PlusIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { type ApiClient, useApiClient } from "@/app";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  SectionHeader,
  UnderConstruction,
} from "@/components";
import { FieldGroup } from "@/components/ui/field";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { invalidateTenantQueries, tenantBindingsQueryOptions } from "@/lib/queries/tenants";
import { ListSkeleton, RowMenu } from "../-admin-ui";

type Binding = Awaited<ReturnType<ApiClient["listTenantBindingsForTenant"]>>[number];

const BINDING_KIND_ITEMS = [
  { label: "Platform alias", value: "alias" },
  { label: "Custom domain", value: "custom" },
];

export function NodeBindings({ tenantId, gateway }: { tenantId: string; gateway: string }) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Binding | null>(null);
  const bindingsQuery = useQuery(tenantBindingsQueryOptions(apiClient, tenantId));
  const mutation = useMutation({
    mutationFn: async ({ binding, action }: { binding: Binding; action: "remove" | "verify" }) => {
      if (action === "remove") await apiClient.deleteBinding({ tenantId, bindingId: binding.id });
      else await apiClient.verifyCustomDomain({ tenantId, bindingId: binding.id });
    },
    onSuccess: async (_, { action }) => {
      await invalidateTenantQueries(queryClient);
      setRemoving(null);
      toast.success(action === "remove" ? "Domain removed" : "Domain verified");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <section className="flex flex-col gap-6">
      <SectionHeader
        title="Domains"
        description="Shared by every community on this site; changes take up to 30 seconds."
        action={
          <Button size="sm" onClick={() => setAdding(true)} data-testid="admin-node-add-domain">
            <PlusIcon /> Add domain
          </Button>
        }
      />
      {bindingsQuery.isLoading ? (
        <ListSkeleton rows={2} />
      ) : bindingsQuery.isError ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-destructive">
            {bindingsQuery.error.message}
          </p>
          <Button variant="outline" size="sm" onClick={() => bindingsQuery.refetch()}>
            Retry
          </Button>
        </div>
      ) : !bindingsQuery.data?.length ? (
        <EmptyState
          icon={GlobeIcon}
          title="No domains yet"
          description="Add a platform alias or bring your own domain."
          className="py-10"
        />
      ) : (
        <ItemGroup data-testid="admin-node-domains">
          {bindingsQuery.data.map((binding) => {
            const isAlias = !binding.hostname.includes(".");
            const hostname = isAlias ? `${binding.hostname}.${gateway}` : binding.hostname;
            const needsVerification = !isAlias && !binding.isVerified;
            const verifying =
              mutation.isPending &&
              mutation.variables?.binding.id === binding.id &&
              mutation.variables.action === "verify";
            return (
              <Item key={binding.id} variant="outline" role="group" aria-label={hostname}>
                <ItemMedia variant="icon">
                  <GlobeIcon />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="max-w-full">
                    <span className="min-w-0 truncate font-mono">{hostname}</span>
                  </ItemTitle>
                  <ItemDescription>{isAlias ? "Platform alias" : "Custom domain"}</ItemDescription>
                  {(binding.isPrimary || !isAlias) && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {binding.isPrimary && <Badge variant="secondary">Primary</Badge>}
                      {!isAlias && (
                        <Badge variant={binding.isVerified ? "success" : "warning"}>
                          {binding.isVerified ? "Verified" : "Unverified"}
                        </Badge>
                      )}
                    </div>
                  )}
                </ItemContent>
                <ItemActions>
                  <RowMenu
                    label={`Actions for ${hostname}`}
                    actions={[
                      {
                        label: "Remove",
                        destructive: true,
                        disabled: mutation.isPending,
                        onSelect: () => setRemoving(binding),
                      },
                    ]}
                  />
                </ItemActions>
                {needsVerification && (
                  <div className="flex basis-full flex-col gap-4 border-t border-border pt-4">
                    <p className="text-sm text-muted-foreground">
                      Add this TXT record at your DNS provider, then check.
                    </p>
                    <dl className="grid grid-cols-4 gap-x-4 gap-y-2 text-sm text-foreground">
                      <dt className="text-muted-foreground">Type</dt>
                      <dd className="col-span-3 font-mono">TXT</dd>
                      <dt className="text-muted-foreground">Host</dt>
                      <dd className="col-span-3 font-mono break-all">{binding.hostname}</dd>
                      <dt className="text-muted-foreground">Value</dt>
                      <dd className="col-span-3 font-mono break-all">
                        everything-verify={binding.verificationToken}
                      </dd>
                    </dl>
                    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                      <Button
                        variant="outline"
                        className="w-full sm:w-auto"
                        disabled={mutation.isPending}
                        onClick={() => mutation.mutate({ binding, action: "verify" })}
                      >
                        {verifying ? "Checking…" : "Check verification"}
                      </Button>
                      <UnderConstruction
                        label="domain routing"
                        url="https://www.reddit.com/r/rust/comments/1qew4ra/near_dns_dns_records_stored_on_blockchain_and/"
                        tooltip="learn about near-dns and contribute"
                      />
                    </div>
                    {mutation.isError &&
                      mutation.variables?.binding.id === binding.id &&
                      mutation.variables.action === "verify" && (
                        <p role="alert" className="text-sm text-destructive">
                          {mutation.error.message}
                        </p>
                      )}
                  </div>
                )}
              </Item>
            );
          })}
        </ItemGroup>
      )}
      <Dialog open={adding} onOpenChange={setAdding}>
        {adding && (
          <AddBindingForm tenantId={tenantId} gateway={gateway} onClose={() => setAdding(false)} />
        )}
      </Dialog>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title="Remove domain?"
        description={`${removing?.hostname ?? "This domain"} will stop routing to this tenant, for every node that shares it.`}
        variant="destructive"
        confirmLabel="Remove domain"
        cancelLabel="Cancel"
        isPending={mutation.isPending}
        onConfirm={() => {
          if (removing) mutation.mutate({ binding: removing, action: "remove" });
        }}
      />
    </section>
  );
}

function AddBindingForm({
  tenantId,
  gateway,
  onClose,
}: {
  tenantId: string;
  gateway: string;
  onClose: () => void;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<string>("alias");
  const [hostname, setHostname] = useState("");
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  const mutation = useMutation({
    mutationFn: () => {
      if (kind === "alias" && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalized)) {
        throw new Error("Enter a single alias using letters, numbers, and hyphens.");
      }
      if (kind === "custom" && !normalized.includes(".")) {
        throw new Error("Enter a full domain such as nyc.gov.");
      }
      return apiClient.createBinding({ tenantId, hostname: normalized });
    },
    onSuccess: async () => {
      await invalidateTenantQueries(queryClient);
      toast.success(
        kind === "alias" ? "Platform alias added" : "Domain added — DNS verification required",
      );
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <DialogContent className="max-h-11/12 overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Add domain</DialogTitle>
        <DialogDescription>Choose a platform alias or bring your own domain.</DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="binding-kind">Domain type</FieldLabel>
            <Select
              value={kind}
              items={BINDING_KIND_ITEMS}
              onValueChange={(value) => {
                if (value === null) return;
                setKind(value);
                setHostname("");
                mutation.reset();
              }}
            >
              <SelectTrigger id="binding-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="alias">Platform alias</SelectItem>
                <SelectItem value="custom">Custom domain</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="binding-hostname">
              {kind === "alias" ? "Alias" : "Domain"}
            </FieldLabel>
            <Input
              id="binding-hostname"
              value={hostname}
              onChange={(event) => setHostname(event.target.value)}
              placeholder={kind === "alias" ? "chicago" : "nyc.gov"}
              autoCapitalize="none"
              spellCheck={false}
              required
            />
            <FieldDescription className="break-all">
              {kind === "alias"
                ? `${normalized || "alias"}.${gateway} — no verification needed.`
                : `${normalized || "Your domain"} — DNS TXT verification required.`}
            </FieldDescription>
          </Field>
        </FieldGroup>
        {mutation.isError && (
          <p role="alert" className="text-sm text-destructive">
            {mutation.error.message}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending || !normalized}>
            {mutation.isPending ? "Adding…" : "Add domain"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
