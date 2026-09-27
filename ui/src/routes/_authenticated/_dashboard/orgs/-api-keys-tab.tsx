import { CopyIcon, KeyIcon, TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import {
  ApiKeyForm,
  type ApiKeyFormValues,
  ApiKeyReveal,
  type ApiKeyRevealProps,
  ConfirmDialog,
  EmptyState,
  LocalDate,
  SectionHeader,
  TabsContent,
} from "@/components";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { RowMenu } from "./-row-menu";

export type OrganizationApiKey = {
  id: string;
  name: string | null;
  prefix: string | null;
  start: string | null;
  createdAt: string | Date;
  expiresAt?: string | Date | null;
  metadata?: Record<string, unknown> | null;
};

export type CreatedOrganizationApiKey = ApiKeyRevealProps["apiKey"];

export function ApiKeysTab({
  apiKeys,
  canManageMembers,
  createdApiKey,
  isCreating,
  isDeleting,
  onCopy,
  onCreate,
  onDelete,
  onDismiss,
}: {
  apiKeys: OrganizationApiKey[];
  canManageMembers: boolean;
  createdApiKey: CreatedOrganizationApiKey | null;
  isCreating: boolean;
  isDeleting: boolean;
  onCopy: (value: string, message: string) => void;
  onCreate: (values: ApiKeyFormValues) => void;
  onDelete: (id: string) => void;
  onDismiss: () => void;
}) {
  const [deleting, setDeleting] = useState<OrganizationApiKey | null>(null);

  return (
    <TabsContent value="apikeys" className="flex flex-col gap-6 pt-6">
      <SectionHeader
        title="API keys"
        description="Let scripts and agents act for this organization."
      />
      {canManageMembers && <ApiKeyForm onCreate={onCreate} isPending={isCreating} />}
      {createdApiKey && <ApiKeyReveal apiKey={createdApiKey} onDismiss={onDismiss} />}

      {apiKeys.length > 0 ? (
        <ItemGroup>
          {apiKeys.map((key, index) => (
            <div key={key.id} className="flex flex-col">
              {index > 0 && <ItemSeparator />}
              <Item size="sm" data-testid={`org-api-key-${key.id}`}>
                <ItemMedia variant="icon">
                  <KeyIcon />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="break-all">{key.name ?? "Unnamed key"}</ItemTitle>
                  <ItemDescription>
                    <span className="font-mono break-all">
                      {key.prefix ?? "api_"}…{key.start ?? ""}
                    </span>{" "}
                    · created <LocalDate value={key.createdAt} />
                    {key.expiresAt ? (
                      <>
                        {" "}
                        · expires <LocalDate value={key.expiresAt} format="relative" />
                      </>
                    ) : null}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <RowMenu label={`Actions for ${key.name ?? "key"}`}>
                    <DropdownMenuItem onClick={() => onCopy(key.start || "", "Key prefix copied")}>
                      <CopyIcon />
                      Copy prefix
                    </DropdownMenuItem>
                    {canManageMembers && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setDeleting(key)}
                          disabled={isDeleting}
                        >
                          <TrashIcon />
                          Delete key
                        </DropdownMenuItem>
                      </>
                    )}
                  </RowMenu>
                </ItemActions>
              </Item>
            </div>
          ))}
        </ItemGroup>
      ) : (
        <EmptyState icon={KeyIcon} title="No API keys" className="py-10" />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "this key"}?`}
        description="Anything using it stops working immediately."
        confirmLabel="Delete key"
        variant="destructive"
        isPending={isDeleting}
        onConfirm={() => {
          if (deleting) onDelete(deleting.id);
          setDeleting(null);
        }}
      />
    </TabsContent>
  );
}
