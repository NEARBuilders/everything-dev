import type { InferClientOutputs } from "@orpc/client";
import { ArrowSquareOutIcon, CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { type ApiClient, useAuthClient } from "@/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatNearBalance,
  formatPoolFee,
  stakePoolStatsQueryOptions,
  stakePoolTopHoldersQueryOptions,
  toNetwork,
} from "@/lib/queries/stake-pool";

type Validator = InferClientOutputs<ApiClient>["getNodeSummary"]["validators"][number];
type Holder = { accountId: string; stakedBalance: bigint };

function explorerUrl(accountId: string, network: string) {
  return `https://${network === "testnet" ? "testnet." : ""}nearblocks.io/address/${encodeURIComponent(accountId)}`;
}

function metadataUrl(metadata: Validator["metadata"]) {
  for (const value of [metadata.stakeUrl, metadata.explorerUrl]) {
    if (typeof value !== "string") continue;
    try {
      const url = new URL(value);
      if (url.protocol === "https:" || url.protocol === "http:") return url.href;
    } catch {}
  }
  return undefined;
}

export function StakePoolCard({ validator }: { validator: Validator }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const network = validator.network || "mainnet";
  const supported =
    validator.protocol === "near" && (network === "mainnet" || network === "testnet");
  const poolUrl = metadataUrl(validator.metadata);

  async function copyAccount() {
    try {
      await navigator.clipboard.writeText(validator.accountId);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <Card data-testid="stake-pool-card">
      <CardHeader className="gap-1">
        <div className="flex items-center gap-1">
          <h3 className="min-w-0 flex-1 truncate font-mono text-base font-medium">
            {validator.accountId}
          </h3>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={copyState === "copied" ? "Copied pool account" : "Copy pool account"}
            onClick={copyAccount}
          >
            {copyState === "copied" ? <CheckIcon /> : <CopyIcon />}
          </Button>
          {supported && (
            <Button
              variant="ghost"
              size="icon-sm"
              nativeButton={false}
              render={
                <a
                  href={explorerUrl(validator.accountId, network)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="View account on Nearblocks"
                >
                  <ArrowSquareOutIcon />
                </a>
              }
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant={validator.role === "community" ? "outline" : "secondary"}>
            <span className="capitalize">{validator.role}</span>
          </Badge>
          {validator.protocol !== "near" && <span className="font-mono">{validator.protocol}</span>}
          {network !== "mainnet" && <span className="capitalize">{network}</span>}
        </div>
        {copyState === "error" && (
          <p role="status" className="text-sm text-muted-foreground">
            Couldn&apos;t copy. Select the account name to copy it.
          </p>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {supported ? (
          <NearPoolStats accountId={validator.accountId} network={network} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {validator.protocol !== "near"
              ? `Live stats are on the ${validator.protocol} explorer.`
              : `Live stats aren't available on ${network}.`}
          </p>
        )}
        {poolUrl && (
          <Button
            variant="link"
            size="sm"
            className="self-start px-0"
            nativeButton={false}
            render={
              <a href={poolUrl} target="_blank" rel="noopener noreferrer">
                View pool on explorer
                <ArrowSquareOutIcon data-icon="inline-end" />
              </a>
            }
          />
        )}
      </CardContent>
    </Card>
  );
}

function NearPoolStats({ accountId, network }: { accountId: string; network: string }) {
  const authClient = useAuthClient();
  const poolNetwork = toNetwork(network);
  const stats = useQuery(
    stakePoolStatsQueryOptions({ accountId, authClient, network: poolNetwork }),
  );
  const holders = useQuery(
    stakePoolTopHoldersQueryOptions({ accountId, authClient, network: poolNetwork }),
  );
  const statsData = stats.isError ? undefined : stats.data;
  const holdersData = holders.isError ? undefined : holders.data;

  return (
    <>
      <dl className="grid grid-cols-3 gap-4">
        <Metric
          label="Total staked"
          loading={stats.isLoading}
          value={statsData && formatNearBalance(statsData.totalStaked)}
        />
        <Metric
          label="Fee"
          loading={stats.isLoading}
          value={statsData && formatPoolFee(statsData.feeNumerator, statsData.feeDenominator)}
        />
        <Metric
          label="Stakers"
          loading={stats.isLoading}
          value={statsData && new Intl.NumberFormat("en-US").format(statsData.stakerCount)}
        />
      </dl>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-sm font-medium">Top stakers</h4>
          {holdersData && holdersData.length > 0 && (
            <span className="text-xs text-muted-foreground">
              Top {Math.min(holdersData.length, 5)} of {holdersData.length}
              {statsData ? ` sampled from ${statsData.stakerCount}` : " sampled"}
            </span>
          )}
        </div>
        {holders.isLoading ? (
          <Skeleton aria-label="Loading pool accounts" className="h-24 w-full" />
        ) : holdersData ? (
          holdersData.length > 0 ? (
            <>
              <HolderList holders={holdersData.slice(0, 5)} network={network} label="Top stakers" />
              {holdersData.length > 5 && (
                <details className="group text-sm">
                  <summary className="cursor-pointer py-2 text-muted-foreground">
                    Show {holdersData.length - 5} more
                  </summary>
                  <HolderList
                    holders={holdersData.slice(5)}
                    network={network}
                    label="More stakers"
                  />
                </details>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No stakers yet.</p>
          )
        ) : (
          <p className="text-sm text-muted-foreground">—</p>
        )}
      </div>
      {(stats.isError || holders.isError) && (
        <p className="text-sm text-muted-foreground" role="status">
          Some pool data is unavailable right now.
        </p>
      )}
    </>
  );
}

function Metric({
  label,
  loading,
  value,
}: {
  label: string;
  loading: boolean;
  value: string | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="break-words text-xl font-semibold tabular-nums sm:text-2xl">
        {loading ? (
          <Skeleton aria-label={`Loading ${label}`} className="h-5 w-24" />
        ) : (
          (value ?? "—")
        )}
      </dd>
    </div>
  );
}

function HolderList({
  holders,
  network,
  label,
}: {
  holders: Holder[];
  network: string;
  label: string;
}) {
  return (
    <ul aria-label={label} className="divide-y divide-border">
      {holders.map((holder) => (
        <li key={holder.accountId} className="flex items-center justify-between gap-3 py-2 text-sm">
          <a
            className="min-w-0 truncate font-mono hover:underline"
            href={explorerUrl(holder.accountId, network)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {holder.accountId}
          </a>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {formatNearBalance(holder.stakedBalance)}
          </span>
        </li>
      ))}
    </ul>
  );
}
