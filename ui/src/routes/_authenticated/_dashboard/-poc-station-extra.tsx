import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { Badge, Field, FieldLabel } from "@/components";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatNear, VOTE_OPTIONS } from "./-poc-chain";
import type { PocLifecycle } from "./-poc-lifecycle";
import type { StationState } from "./-poc-stations";

export function PocStationExtra({ lc, station }: { lc: PocLifecycle; station: StationState }) {
  const {
    facts,
    tenantUrl,
    team,
    govProposals,
    govProposal,
    values,
    form,
    fundYocto,
    requirementYocto,
  } = lc;

  if (station.def.id === "publish" && facts.tenantDeployed) {
    return (
      <div className="flex flex-wrap items-center gap-3" data-testid="poc-publish-state">
        {facts.configPublished ? (
          <>
            <Badge variant="success">Config live</Badge>
            {tenantUrl && (
              <a
                href={tenantUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                data-testid="poc-open-tenant"
              >
                Open {tenantUrl.replace(/^https?:\/\//, "")}
                <ArrowSquareOutIcon className="shrink-0" />
              </a>
            )}
          </>
        ) : (
          <span className="text-sm text-muted-foreground">
            Config not live yet. The Trezu proposal can report failed even when the write lands —
            this check is the source of truth.
            {team ? (
              <>
                {" "}
                <a
                  href={`https://trezu.app/${team}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  View proposals on Trezu
                </a>
              </>
            ) : null}
          </span>
        )}
      </div>
    );
  }

  if (station.def.id === "vote" && govProposals.length > 0) {
    return (
      <div className="grid gap-4 sm:grid-cols-3">
        <Field className="sm:col-span-2">
          <FieldLabel>Proposal</FieldLabel>
          <Select
            value={values.govProposalId || (govProposal ? String(govProposal.id) : "")}
            items={govProposals.map((proposal) => ({
              value: String(proposal.id),
              label: `#${proposal.id} ${proposal.title ?? "untitled"}`,
            }))}
            onValueChange={(value) => {
              if (value !== null) form.setFieldValue("govProposalId", value);
            }}
          >
            <SelectTrigger className="w-full" data-testid="poc-vote-proposal">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {govProposals.map((proposal) => (
                <SelectItem key={proposal.id} value={String(proposal.id)}>
                  #{proposal.id} {proposal.title ?? "untitled"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>Vote</FieldLabel>
          <Select
            value={values.voteOption}
            onValueChange={(value) => {
              if (value !== null) form.setFieldValue("voteOption", value);
            }}
          >
            <SelectTrigger className="w-full" data-testid="poc-vote-option">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VOTE_OPTIONS.map((option) => (
                <SelectItem
                  key={option}
                  value={option}
                  disabled={govProposal?.status === "Sandbox" && option !== "For"}
                >
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
    );
  }

  if (station.def.id === "fund") {
    return (
      <div className="flex flex-wrap gap-8" data-testid="poc-fund-detail">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">Transfers</span>
          <span className="text-2xl font-semibold text-foreground tabular-nums">
            {formatNear(fundYocto.toString())}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">Deposits needed later</span>
          <span className="text-2xl font-semibold text-foreground tabular-nums">
            {formatNear(requirementYocto.toString())}
          </span>
        </div>
      </div>
    );
  }

  if (station.def.id === "sponsor-unwind") {
    return (
      <p className="text-sm text-muted-foreground">
        Rewards accrue to the pool's stakers and owner — the cycle starts again for the next node.
      </p>
    );
  }

  return null;
}
