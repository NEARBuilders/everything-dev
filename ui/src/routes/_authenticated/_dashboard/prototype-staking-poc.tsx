import {
  ArrowsClockwiseIcon,
  BankIcon,
  CaretDownIcon,
  CaretUpIcon,
  FlaskIcon,
  PlayIcon,
} from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  EmptyState,
  InfoPopover,
  PageContainer,
  PageHeader,
  SectionHeader,
} from "@/components";
import { OrgSwitcherMenuContent } from "@/components/layout/org-switcher-menu";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { pageTitle } from "@/lib/page-title";
import { PocChainState } from "./-poc-chain-state";
import { usePocLifecycle } from "./-poc-lifecycle";
import { PocLogSheet } from "./-poc-log-sheet";
import { PocPhaseStepper } from "./-poc-phase-stepper";
import { PocActors, PocSetupFields, PocTreasuryConnection } from "./-poc-setup";
import { StationListRow, StationPanel, signerName } from "./-poc-station";
import { PocStationExtra } from "./-poc-station-extra";
import { LENS_OPTIONS, PHASES, type PhaseId, type StationId, signerLens } from "./-poc-stations";
import { followingStation, phaseProgress, resolveFocus, resolvePhase } from "./-poc-walkthrough";

export const Route = createFileRoute("/_authenticated/_dashboard/prototype-staking-poc")({
  head: ({ match }) => ({
    meta: [
      { title: pageTitle("Node lifecycle POC", match.context.runtimeConfig) },
      {
        name: "description",
        content:
          "One node, end to end: apply, approve and assign the pool, fund the team treasury, stake, lock veNEAR, sponsor, and vote in House of Stake.",
      },
    ],
  }),
  component: NodeLifecyclePocPage,
});

function NodeLifecyclePocPage() {
  const { auth: routeAuth, runtimeConfig } = Route.useRouteContext();
  const lc = usePocLifecycle(routeAuth, runtimeConfig);
  const {
    organizations,
    activeOrg,
    activeOrgId,
    form,
    values,
    team,
    entries,
    refresh,
    stations,
    runnable,
    upcoming,
    stagedCount,
    busy,
    policyFor,
    platformAuditWarning,
    trezuMembersUrl,
    runStation,
    requireConnected,
    runChainMutation,
    approveMutation,
  } = lc;

  const [selectedPhase, setSelectedPhase] = useState<PhaseId | null>(null);
  const [selectedStation, setSelectedStation] = useState<StationId | null>(null);
  const [setupOpen, setSetupOpen] = useState<boolean | null>(null);

  const setupComplete = !!team && !!values.name.trim() && !!values.pool.trim();
  const showSetup = setupOpen ?? !setupComplete;
  const activePhase = resolvePhase(stations, selectedPhase);
  const progress = phaseProgress(stations, activePhase);
  const phaseStations = stations.filter((station) => station.def.phase === activePhase);
  const focused = resolveFocus(stations, activePhase, selectedStation);
  const phase = PHASES.find((entry) => entry.id === activePhase);

  const orgSwitcher = (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" data-testid="poc-org-switcher" />}>
        <BankIcon />
        {activeOrg?.name ?? "Select an organization"}
      </DropdownMenuTrigger>
      <OrgSwitcherMenuContent
        organizations={organizations}
        activeOrgId={activeOrgId}
        align="start"
      />
    </DropdownMenu>
  );

  const header = (
    <PageHeader
      icon={FlaskIcon}
      label="Prototype"
      headerTestId="prototype-staking-poc.heading"
      title="Node lifecycle"
      description="Take one node from application to governance, one station at a time."
      actions={
        <>
          <PocLogSheet entries={entries} />
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            aria-label="Refresh chain state"
            data-testid="poc-refresh"
          >
            <ArrowsClockwiseIcon />
          </Button>
        </>
      }
    />
  );

  if (!activeOrgId) {
    return (
      <PageContainer variant="wide">
        {header}
        <section className="flex flex-col gap-4">
          <SectionHeader title="Setup" sectionTestId="poc-actors" />
          <EmptyState
            icon={BankIcon}
            title="Pick an organization"
            description={
              <span data-testid="poc-org-required">The node is created for this organization.</span>
            }
            action={orgSwitcher}
          />
        </section>
      </PageContainer>
    );
  }

  const selectStation = (id: StationId) => {
    const station = stations.find((entry) => entry.def.id === id);
    if (station) setSelectedPhase(station.def.phase);
    setSelectedStation(id);
  };

  return (
    <PageContainer variant="wide">
      {header}

      <section className="flex flex-col gap-6">
        <SectionHeader
          title="Setup"
          sectionTestId="poc-actors"
          description={showSetup ? "Who signs what, and the node you are standing up." : undefined}
          action={
            <div className="flex flex-wrap items-center gap-2">
              {orgSwitcher}
              <Button
                variant="ghost"
                onClick={() => setSetupOpen(!showSetup)}
                aria-expanded={showSetup}
                data-testid="poc-setup-toggle"
              >
                {showSetup ? <CaretUpIcon /> : <CaretDownIcon />}
                {showSetup ? "Hide" : "Edit"}
              </Button>
            </div>
          }
        />
        <PocActors lc={lc} />
        {showSetup && (
          <div className="flex flex-col gap-6" data-testid="poc-setup">
            <PocTreasuryConnection lc={lc} />
            <PocSetupFields lc={lc} />
          </div>
        )}
      </section>

      <section className="flex flex-col gap-6">
        <SectionHeader
          title="Lifecycle"
          sectionTestId="poc-lifecycle"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup
                variant="outline"
                spacing={0}
                value={[values.lens]}
                onValueChange={(value) => {
                  const next = LENS_OPTIONS.find((option) => value.includes(option.id));
                  if (next) form.setFieldValue("lens", next.id);
                }}
                aria-label="Acting as"
                data-testid="poc-lens"
              >
                {LENS_OPTIONS.map((option) => (
                  <ToggleGroupItem
                    key={option.id}
                    value={option.id}
                    data-testid={`poc-lens-${option.id}`}
                  >
                    {option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <InfoPopover
                title="Acting as"
                body="Pick the role you're acting as. Stations another role signs stay visible, with their actions hidden."
              />
            </div>
          }
        />

        <PocPhaseStepper
          progress={progress}
          activePhase={activePhase}
          onSelect={(id) => {
            setSelectedPhase(id);
            setSelectedStation(null);
          }}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 text-sm text-muted-foreground" data-testid="poc-phase-blurb">
            {phase?.blurb}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {stagedCount > 0 && <Badge variant="warning">{stagedCount} awaiting votes</Badge>}
            <Button
              variant="outline"
              onClick={() => runChainMutation.mutate()}
              disabled={busy || runnable.length === 0}
              data-testid="poc-run-chain"
            >
              {busy ? <Spinner /> : <PlayIcon />}
              Run all I can sign{runnable.length > 0 ? ` (${runnable.length})` : ""}
            </Button>
          </div>
        </div>

        {runnable.length === 0 && upcoming && (
          <p className="text-sm text-muted-foreground" data-testid="poc-next-hint">
            Next up: <span className="font-medium text-foreground">{upcoming.def.title}</span>,
            signed by {signerName(upcoming)}
            {upcoming.signerAccountId ? (
              <span className="font-mono break-all"> ({upcoming.signerAccountId})</span>
            ) : null}
            {upcoming.blockedBy === "input" && upcoming.blockedReason
              ? ` — ${upcoming.blockedReason}`
              : !upcoming.signerConnected
                ? " — connect it to continue"
                : ""}
          </p>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <nav
            aria-label="Stations"
            className="flex flex-col gap-1 lg:col-span-1"
            data-testid="poc-station-list"
          >
            {phaseStations.map((station) => (
              <StationListRow
                key={station.def.id}
                station={station}
                active={station.def.id === focused?.def.id}
                dimmed={signerLens(station.def.signer) !== values.lens}
                onSelect={() => selectStation(station.def.id)}
              />
            ))}
          </nav>
          <div className="min-w-0 lg:col-span-2">
            {focused && (
              <StationPanel
                station={focused}
                lens={values.lens}
                busy={busy}
                policy={policyFor(focused.def.signer)}
                warning={focused.def.id === "approve" ? platformAuditWarning : null}
                membersHref={focused.def.id === "approve" ? trezuMembersUrl : null}
                next={followingStation(stations, focused.def.id)}
                extra={<PocStationExtra lc={lc} station={focused} />}
                onRun={() => void runStation(focused).catch(() => {})}
                onConnect={() =>
                  void requireConnected(focused.def.signer).catch((error) =>
                    toast.error(error instanceof Error ? error.message : String(error)),
                  )
                }
                onApprove={(proposalId) =>
                  approveMutation.mutate({
                    signer: focused.def.signer,
                    dao: focused.signerAccountId ?? "",
                    proposalId,
                  })
                }
                onLens={(lens) => form.setFieldValue("lens", lens)}
                onNext={(station) => selectStation(station.def.id)}
              />
            )}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <SectionHeader title="Chain state" sectionTestId="poc-state" />
        <PocChainState lc={lc} />
      </section>
    </PageContainer>
  );
}
