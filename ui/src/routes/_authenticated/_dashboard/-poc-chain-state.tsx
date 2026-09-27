import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import {
  Badge,
  Button,
  InfoPopover,
  InfoRow,
  SectionHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components";
import {
  accountExplorerUrl,
  formatNear,
  isPositive,
  nearblocksAccount,
  poolFeePercent,
  sumVenear,
  VOTE_OPTIONS,
} from "./-poc-chain";
import { HOS_URL, hosDelegateUrl, type PocLifecycle } from "./-poc-lifecycle";

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
    >
      {children}
    </a>
  );
}

function YesNo({ value }: { value: boolean }) {
  return <Badge variant={value ? "success" : "outline"}>{value ? "Yes" : "No"}</Badge>;
}

function Panel({
  title,
  testId,
  info,
  action,
  children,
}: {
  title: string;
  testId: string;
  info?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <SectionHeader
        title={title}
        sectionTestId={testId}
        action={
          <div className="flex items-center gap-2">
            {action}
            {info}
          </div>
        }
      />
      <div>{children}</div>
    </div>
  );
}

export function PocChainState({ lc }: { lc: PocLifecycle }) {
  const {
    team,
    facts,
    teamVe,
    treasuryBalance,
    requirementYocto,
    treasuryFunded,
    voteRecord,
    treasuriesShared,
    endowmentLockup,
    endowmentLockupState,
    endowmentPoolAccount,
    endowmentVe,
    poolMeta,
    whitelisted,
    teamPoolAccount,
    application,
    tenantRecord,
    tenantBinding,
    publishPendingProposal,
    fastKvUrl,
    tenantUrl,
    tenantDisplayHost,
  } = lc;

  return (
    <Tabs defaultValue="team" data-testid="poc-chain-state">
      <TabsList>
        <TabsTrigger value="team" data-testid="poc-state-tab-team">
          Team
        </TabsTrigger>
        <TabsTrigger value="endowment" data-testid="poc-state-tab-endowment">
          Endowment
        </TabsTrigger>
        <TabsTrigger value="pool" data-testid="poc-state-tab-pool">
          Pool
        </TabsTrigger>
        {application && (
          <TabsTrigger value="tenant" data-testid="poc-state-tab-tenant">
            Tenant
          </TabsTrigger>
        )}
      </TabsList>

      <TabsContent value="team" className="pt-4">
        <Panel
          title="Team"
          testId="poc-team-state"
          info={
            <InfoPopover
              title="Voter and pool owner"
              body="Registers in veNEAR, locks NEAR for voting power, owns the node's pool, and casts the votes — its own lock plus any delegated sponsor power."
              links={
                team
                  ? [{ label: "House of Stake profile", href: hosDelegateUrl(team) }]
                  : [{ label: "House of Stake", href: HOS_URL }]
              }
            />
          }
        >
          <InfoRow label="Registered in veNEAR" value={<YesNo value={facts.teamRegistered} />} />
          <InfoRow label="Own veNEAR" value={formatNear(sumVenear(teamVe?.account.balance))} mono />
          <InfoRow
            label="Delegated in"
            value={formatNear(sumVenear(teamVe?.account.delegated_balance))}
            mono
          />
          <InfoRow label="Treasury balance" value={formatNear(treasuryBalance)} mono />
          <InfoRow
            label="Bootstrap requirement"
            value={formatNear(requirementYocto.toString())}
            mono
          />
          <InfoRow label="Funded" value={<YesNo value={treasuryFunded} />} />
          <InfoRow
            label="Vote cast"
            value={
              voteRecord != null ? (
                (VOTE_OPTIONS[voteRecord] ?? String(voteRecord))
              ) : team ? (
                <ExternalLink href={hosDelegateUrl(team)}>View on House of Stake</ExternalLink>
              ) : (
                "—"
              )
            }
          />
          {treasuriesShared && (
            <p className="pt-3 text-sm text-muted-foreground">
              Same account as the endowment — the sponsor stations are skipped.
            </p>
          )}
        </Panel>
      </TabsContent>

      <TabsContent value="endowment" className="pt-4">
        <Panel
          title="Endowment"
          testId="poc-endowment-state"
          info={
            <InfoPopover
              title="veNEAR lockup"
              body="The sponsor's lockup: locked NEAR mints veNEAR voting power, and the same locked NEAR is staked into the node's pool from the lockup — the capital works twice."
              links={[{ label: "House of Stake", href: HOS_URL }]}
            />
          }
        >
          <InfoRow
            label="Lockup"
            value={
              endowmentLockup ? (
                <ExternalLink href={nearblocksAccount(endowmentLockup)}>
                  {endowmentLockup}
                </ExternalLink>
              ) : (
                "—"
              )
            }
            mono
          />
          <InfoRow label="Locked" value={formatNear(endowmentLockupState?.locked)} mono />
          <InfoRow label="Liquid" value={formatNear(endowmentLockupState?.liquid)} mono />
          <InfoRow
            label="Staked from lockup"
            value={formatNear(endowmentLockupState?.knownDeposited)}
            mono
          />
          <InfoRow
            label="Unstaking"
            value={
              endowmentPoolAccount && isPositive(endowmentPoolAccount.unstaked_balance)
                ? `${formatNear(endowmentPoolAccount.unstaked_balance)}${endowmentPoolAccount.can_withdraw ? "" : " — epoch window"}`
                : "—"
            }
            mono
          />
          <InfoRow
            label="Delegates to"
            value={
              endowmentVe && endowmentVe.account.delegations.length > 0
                ? endowmentVe.account.delegations
                    .map((entry) => `${entry.account_id} (${entry.bps} bps)`)
                    .join(", ")
                : "—"
            }
            mono
          />
        </Panel>
      </TabsContent>

      <TabsContent value="pool" className="pt-4">
        <Panel
          title="Pool"
          testId="poc-pool"
          action={
            <>
              {poolMeta?.paused && <Badge variant="destructive">Paused</Badge>}
              {whitelisted !== undefined && (
                <Badge variant={whitelisted ? "success" : "outline"}>
                  {whitelisted ? "Whitelisted" : "Not whitelisted"}
                </Badge>
              )}
            </>
          }
        >
          {poolMeta ? (
            <>
              <InfoRow
                label="Owner"
                value={
                  poolMeta.owner ? (
                    <ExternalLink href={accountExplorerUrl(poolMeta.owner)}>
                      {poolMeta.owner}
                    </ExternalLink>
                  ) : (
                    "unknown"
                  )
                }
                mono
              />
              <InfoRow
                label="Rewards"
                value={
                  poolMeta.owner && team && poolMeta.owner === team ? (
                    <Badge variant="success">Team-owned — fees come to the team</Badge>
                  ) : (
                    <Badge variant="outline">External pool</Badge>
                  )
                }
              />
              <InfoRow label="Fee" value={poolFeePercent(poolMeta.fee) ?? poolMeta.fee} mono />
              <InfoRow label="Total staked" value={formatNear(poolMeta.totalStaked)} mono />
              <InfoRow
                label="Team stake"
                value={formatNear(teamPoolAccount?.staked_balance)}
                mono
              />
              <InfoRow
                label="Endowment stake"
                value={formatNear(endowmentPoolAccount?.staked_balance)}
                mono
              />
            </>
          ) : (
            <p className="py-3 text-sm text-muted-foreground">
              Pool not found, or not a staking pool contract.
            </p>
          )}
        </Panel>
      </TabsContent>

      {application && (
        <TabsContent value="tenant" className="pt-4">
          <Panel
            title="Tenant"
            testId="poc-tenant"
            info={
              <InfoPopover
                title="Tenant state"
                body="The DB record and binding are created by the approve station; the config goes live in FastKV when the team's publish proposal passes. A tenant page that renders means its config is live — a 404 means it is not. Locally the link points at <slug>.localhost, which the host maps back to the gateway alias in development."
                links={
                  tenantUrl && facts.configPublished
                    ? [{ label: "Open the tenant", href: tenantUrl }]
                    : []
                }
              />
            }
          >
            <InfoRow
              label="Record"
              value={
                tenantRecord ? (
                  <span
                    className="inline-flex flex-wrap items-center gap-2"
                    data-testid="poc-tenant-record"
                  >
                    <Badge variant="success">{tenantRecord.status}</Badge>
                    <span className="truncate">{tenantRecord.name}</span>
                  </span>
                ) : (
                  <Badge variant="outline">Not created</Badge>
                )
              }
            />
            <InfoRow
              label="Binding"
              value={
                tenantBinding ? (
                  <span
                    className="inline-flex flex-wrap items-center gap-2"
                    data-testid="poc-tenant-binding"
                  >
                    <span className="truncate">{tenantBinding.hostname}</span>
                    {tenantBinding.isPrimary && <Badge variant="outline">Primary</Badge>}
                    {tenantBinding.isVerified && <Badge variant="outline">Verified</Badge>}
                  </span>
                ) : (
                  <Badge variant="outline">Not created</Badge>
                )
              }
              mono
            />
            <InfoRow
              label="Config"
              value={
                <span
                  className="inline-flex flex-wrap items-center gap-2"
                  data-testid="poc-tenant-config"
                >
                  {facts.configPublished ? (
                    <Badge variant="success">Live</Badge>
                  ) : publishPendingProposal ? (
                    <Badge variant="warning">Awaiting votes #{publishPendingProposal.id}</Badge>
                  ) : (
                    <Badge variant="outline">Not published</Badge>
                  )}
                  {fastKvUrl && <ExternalLink href={fastKvUrl}>View on FastKV</ExternalLink>}
                </span>
              }
            />
            <InfoRow
              label="Hostname"
              value={
                tenantUrl && facts.configPublished ? (
                  <ExternalLink href={tenantUrl}>{tenantDisplayHost}</ExternalLink>
                ) : (
                  tenantDisplayHost
                )
              }
              mono
            />
            <InfoRow
              label="Application"
              value={application ? `${application.reviewStatus} / ${application.applyStatus}` : "—"}
              mono
            />
            {tenantUrl && facts.configPublished && (
              <Button
                variant="outline"
                className="mt-3"
                nativeButton={false}
                render={
                  <a href={tenantUrl} target="_blank" rel="noreferrer">
                    <ArrowSquareOutIcon />
                    Open {tenantUrl.replace(/^https?:\/\//, "")}
                  </a>
                }
              />
            )}
          </Panel>
        </TabsContent>
      )}
    </Tabs>
  );
}
