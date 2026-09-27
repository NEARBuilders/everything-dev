import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { useApiClient } from "@/app";
import { EmptyState } from "@/components";
import { Button } from "@/components/ui/button";
import { StakeNoValidator } from "./-stake-no-validator";
import { StakeSkeleton } from "./-stake-skeleton";
import { StakeValidatorList } from "./-stake-validator-list";

type ApiClient = ReturnType<typeof useApiClient>;
type Node = Awaited<ReturnType<ApiClient["getNode"]>>;
type Validator = Awaited<ReturnType<ApiClient["resolveStakingValidators"]>>["validators"][number];
type ChildNode = Awaited<ReturnType<ApiClient["listChildren"]>>[number];

export function StakeNodeContent({
  aside,
  childNodes,
  isInherited,
  node,
  nodeLoading,
  onSelectValidator,
  selectedValidatorId,
  sourceNode,
  stakingLoading,
  validators,
}: {
  aside: ReactNode;
  childNodes: ChildNode[];
  isInherited: boolean;
  node: Node | undefined;
  nodeLoading: boolean;
  onSelectValidator: (validatorId: string) => void;
  selectedValidatorId: string | null;
  sourceNode: Node | undefined;
  stakingLoading: boolean;
  validators: Validator[];
}) {
  if (nodeLoading || stakingLoading) return <StakeSkeleton />;
  if (!node) {
    return (
      <EmptyState
        icon={MagnifyingGlassIcon}
        title="Community not found"
        description="It may have moved or not be set up yet."
        action={
          <Button nativeButton={false} render={<Link to="/stake" />}>
            See all communities
          </Button>
        }
      />
    );
  }
  if (validators.length === 0) {
    return (
      <StakeNoValidator
        name={node.name}
        childNodes={childNodes.map(({ id, name, slug }) => ({ id, name, slug }))}
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-3">
        {isInherited && sourceNode && (
          <p className="text-sm text-muted-foreground" data-testid="stake.inherited">
            {node.name} uses the validator from{" "}
            <span className="font-medium text-foreground">{sourceNode.name}</span>.
          </p>
        )}
        <StakeValidatorList
          validators={validators}
          selectedValidatorId={selectedValidatorId}
          onSelect={onSelectValidator}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-24 lg:col-span-2 lg:self-start">
        {aside}
      </div>
    </div>
  );
}
