import { useQuery } from "@tanstack/react-query";
import { type useApiClient, useAuthClient } from "@/app";
import { Badge } from "@/components/ui/badge";
import { Field, FieldContent, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  formatNearBalance,
  formatPoolFee,
  stakePoolStatsQueryOptions,
  toNetwork,
} from "@/lib/queries/stake-pool";

type ApiClient = ReturnType<typeof useApiClient>;
export type StakeValidator = Awaited<
  ReturnType<ApiClient["resolveStakingValidators"]>
>["validators"][number];

export function StakeValidatorList({
  onSelect,
  selectedValidatorId,
  validators,
}: {
  onSelect: (validatorId: string) => void;
  selectedValidatorId: string | null;
  validators: StakeValidator[];
}) {
  return (
    <FieldSet data-testid="stake.pool-list">
      <FieldLegend>{validators.length > 1 ? "Choose a pool" : "Pool"}</FieldLegend>
      <RadioGroup
        value={selectedValidatorId}
        onValueChange={(value) => {
          if (typeof value === "string") onSelect(value);
        }}
      >
        {validators.map((validator) => (
          <FieldLabel key={validator.id} htmlFor={`validator-${validator.id}`}>
            <Field orientation="horizontal" data-testid={`stake.pool-${validator.accountId}`}>
              <FieldContent className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="max-w-full min-w-0 truncate font-mono text-sm font-medium text-foreground">
                    {validator.accountId}
                  </span>
                  {validator.isDefault && <Badge variant="success">Recommended</Badge>}
                  {validator.role === "community" && <Badge variant="outline">Community</Badge>}
                </div>
                <PoolSummary validator={validator} />
              </FieldContent>
              <RadioGroupItem id={`validator-${validator.id}`} value={validator.id} />
            </Field>
          </FieldLabel>
        ))}
      </RadioGroup>
    </FieldSet>
  );
}

function PoolSummary({ validator }: { validator: StakeValidator }) {
  const authClient = useAuthClient();
  const network = toNetwork(validator.network || "mainnet");
  const stats = useQuery(
    stakePoolStatsQueryOptions({
      accountId: validator.accountId,
      authClient,
      network,
      protocol: validator.protocol || "near",
    }),
  );
  if (validator.protocol && validator.protocol !== "near") {
    return (
      <p className="text-sm text-muted-foreground">
        {`A ${validator.protocol} pool. It can't receive NEAR here.`}
      </p>
    );
  }
  if (!stats.data) {
    return (
      <p className="text-sm text-muted-foreground">
        {stats.isLoading ? "Loading pool stats…" : network === "mainnet" ? "NEAR pool" : network}
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      {`${formatPoolFee(stats.data.feeNumerator, stats.data.feeDenominator)} fee · ${formatNearBalance(stats.data.totalStaked)} staked`}
    </p>
  );
}
