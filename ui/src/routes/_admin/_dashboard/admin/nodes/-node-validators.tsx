import { PlusIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
  FieldLabel,
  Input,
  SectionHeader,
} from "@/components";
import { Checkbox } from "@/components/ui/checkbox";
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
import { invalidateNodeQueries } from "@/lib/queries/nodes";
import { humanize, RowMenu } from "../-admin-ui";

type Validator = Awaited<ReturnType<ApiClient["getNodeSummary"]>>["validators"][number];

const VALIDATOR_ROLE_ITEMS = [
  { label: "Community", value: "community" },
  { label: "Official", value: "official" },
];

export function NodeValidators({
  nodeId,
  validators,
}: {
  nodeId: string;
  validators: Validator[];
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Validator | null>(null);
  const mutation = useMutation({
    mutationFn: async ({
      validator,
      action,
    }: {
      validator: Validator;
      action: "remove" | "default";
    }) => {
      if (action === "remove") await apiClient.deleteValidator({ validatorId: validator.id });
      else await apiClient.setDefaultValidator({ validatorId: validator.id });
    },
    onSuccess: async (_, { action }) => {
      await invalidateNodeQueries(queryClient);
      setRemoving(null);
      toast.success(action === "remove" ? "Validator removed" : "Default validator updated");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <section className="flex flex-col gap-6">
      <SectionHeader
        title="Validators"
        description="Staking pools attached to this community."
        action={
          <Button size="sm" onClick={() => setAdding(true)} data-testid="admin-node-add-validator">
            <PlusIcon /> Add validator
          </Button>
        }
      />
      {validators.length === 0 ? (
        <EmptyState
          icon={ShieldCheckIcon}
          title="No validators yet"
          description="Add a staking pool so people can stake with this community."
          className="py-10"
        />
      ) : (
        <ItemGroup data-testid="admin-node-validators">
          {validators.map((validator) => (
            <Item key={validator.id} variant="outline">
              <ItemMedia variant="icon">
                <ShieldCheckIcon />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="max-w-full">
                  <span className="min-w-0 truncate font-mono">{validator.accountId}</span>
                </ItemTitle>
                <ItemDescription>
                  {humanize(validator.role)} · {validator.network} · {validator.protocol}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                {validator.isDefault && <Badge variant="success">Default</Badge>}
                <RowMenu
                  label={`Actions for ${validator.accountId}`}
                  actions={[
                    ...(validator.isDefault
                      ? []
                      : [
                          {
                            label: "Make default",
                            disabled: mutation.isPending,
                            onSelect: () => mutation.mutate({ validator, action: "default" }),
                          },
                        ]),
                    {
                      label: "Remove",
                      destructive: true,
                      disabled: mutation.isPending,
                      onSelect: () => setRemoving(validator),
                    },
                  ]}
                />
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
      <Dialog open={adding} onOpenChange={setAdding}>
        {adding && <AddValidatorForm nodeId={nodeId} onClose={() => setAdding(false)} />}
      </Dialog>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title="Remove validator?"
        description={`${removing?.accountId ?? "This validator"} will be detached from this node. Staking may resolve elsewhere.`}
        variant="destructive"
        confirmLabel="Remove validator"
        cancelLabel="Cancel"
        isPending={mutation.isPending}
        onConfirm={() => {
          if (removing) mutation.mutate({ validator: removing, action: "remove" });
        }}
      />
    </section>
  );
}

function AddValidatorForm({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState("");
  const [network, setNetwork] = useState("mainnet");
  const [protocol, setProtocol] = useState("near");
  const [role, setRole] = useState<Validator["role"]>("community");
  const [isDefault, setIsDefault] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const mutation = useMutation({
    mutationFn: () =>
      apiClient.createValidator({
        nodeId,
        accountId: accountId.trim(),
        network: network.trim(),
        protocol: protocol.trim(),
        role,
        isDefault,
      }),
    onSuccess: async () => {
      await invalidateNodeQueries(queryClient);
      toast.success("Validator added");
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <DialogContent className="max-h-11/12 overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Add validator</DialogTitle>
        <DialogDescription>Attach a staking pool to this community.</DialogDescription>
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
            <FieldLabel htmlFor="validator-account">Pool account</FieldLabel>
            <Input
              id="validator-account"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              placeholder="everything.pool.near"
              required
              className="font-mono"
            />
          </Field>
          {showAdvanced ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="validator-network">Network</FieldLabel>
                <Input
                  id="validator-network"
                  value={network}
                  onChange={(event) => setNetwork(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="validator-protocol">Protocol</FieldLabel>
                <Input
                  id="validator-protocol"
                  value={protocol}
                  onChange={(event) => setProtocol(event.target.value)}
                  required
                />
              </Field>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => setShowAdvanced(true)}
            >
              Change network ({network}, {protocol})
            </Button>
          )}
          <Field>
            <FieldLabel htmlFor="validator-role">Role</FieldLabel>
            <Select
              value={role}
              items={VALIDATOR_ROLE_ITEMS}
              onValueChange={(value) => setRole(value === "official" ? "official" : "community")}
            >
              <SelectTrigger id="validator-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="community">Community</SelectItem>
                <SelectItem value="official">Official</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              id="validator-default"
              checked={isDefault}
              onCheckedChange={(checked) => setIsDefault(checked === true)}
            />
            <FieldLabel htmlFor="validator-default">Make this the community's default</FieldLabel>
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
          <Button
            type="submit"
            disabled={
              mutation.isPending || !accountId.trim() || !network.trim() || !protocol.trim()
            }
          >
            {mutation.isPending ? "Adding…" : "Add validator"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
