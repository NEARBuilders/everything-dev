import type { InferClientOutputs } from "@orpc/client";
import { HardDrivesIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { ApiClient } from "@/app";
import { Badge } from "@/components/ui/badge";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";

type Validator = InferClientOutputs<ApiClient>["getNodeSummary"]["validators"][number];

export function NodeValidatorTable({
  validators,
  renderActions,
}: {
  validators: Validator[];
  renderActions?: (validator: Validator) => ReactNode;
}) {
  return (
    <ItemGroup data-testid="node-validators">
      {validators.map((validator) => (
        <Item key={validator.id} variant="outline" size="sm">
          <ItemMedia variant="icon">
            <HardDrivesIcon />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="max-w-full">
              <span className="truncate font-mono">{validator.accountId}</span>
            </ItemTitle>
            <ItemDescription>
              {validator.network} · {validator.protocol}
            </ItemDescription>
          </ItemContent>
          <ItemActions className="flex-wrap">
            {validator.isDefault && <Badge variant="success">Default</Badge>}
            <Badge variant="outline">{validator.role}</Badge>
            {renderActions?.(validator)}
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  );
}
