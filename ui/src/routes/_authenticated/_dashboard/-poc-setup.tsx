import {
  CheckCircleIcon,
  CircleIcon,
  GavelIcon,
  LinkBreakIcon,
  LinkIcon,
  StackIcon,
  WalletIcon,
} from "@phosphor-icons/react";
import type { ComponentType, ReactNode } from "react";
import { Button, Field, FieldLabel, InfoPopover, type InfoPopoverLink, Input } from "@/components";
import { FieldDescription, FieldGroup } from "@/components/ui/field";
import { nearblocksAccount } from "./-poc-chain";
import type { PocForm } from "./-poc-form";
import { POOL_PLACEHOLDER, type PocLifecycle, TREZU_CREATE_URL } from "./-poc-lifecycle";

function ReadOnlyField({
  id,
  label,
  value,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        disabled
        readOnly
        className="font-mono"
        data-testid={id}
      />
    </Field>
  );
}

type PocFormFieldName = "name" | "pool" | "endowment" | "sponsorAmount";

function PocFormField({
  form,
  name,
  label,
  type,
  placeholder,
  mono,
  description,
}: {
  form: PocForm;
  name: PocFormFieldName;
  label: string;
  type?: string;
  placeholder?: string;
  mono?: boolean;
  description?: ReactNode;
}) {
  return (
    <form.Field name={name}>
      {(field) => (
        <Field>
          <FieldLabel htmlFor={`poc-${name}`}>{label}</FieldLabel>
          <Input
            id={`poc-${name}`}
            type={type}
            value={field.state.value}
            placeholder={placeholder}
            onChange={(event) => field.handleChange(event.target.value)}
            className={mono ? "font-mono" : undefined}
            data-testid={`poc-${name}`}
          />
          {description && <FieldDescription>{description}</FieldDescription>}
        </Field>
      )}
    </form.Field>
  );
}

function ConnectField({
  id,
  label,
  connecting,
  onClick,
  testId,
  children,
}: {
  id: string;
  label: string;
  connecting: boolean;
  onClick: () => void;
  testId: string;
  children: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Button
        id={id}
        variant="outline"
        className="w-full justify-start"
        onClick={onClick}
        disabled={connecting}
        data-testid={testId}
      >
        {connecting ? "Connecting…" : children}
      </Button>
    </Field>
  );
}

function ActorRow({
  icon: Icon,
  label,
  account,
  connected,
  popover,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  account: string | null;
  connected: boolean;
  popover: { title: string; body: string; links: InfoPopoverLink[] };
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-2xl border border-border px-4 py-3"
      data-testid={`poc-actor-${label}`}
    >
      <Icon className="size-5 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {account ?? "not set"}
        </span>
      </div>
      {connected ? (
        <CheckCircleIcon
          className="size-4 shrink-0 text-success"
          weight="fill"
          aria-label="connected"
        />
      ) : (
        <CircleIcon className="size-4 shrink-0 text-muted-foreground" aria-label="not connected" />
      )}
      <InfoPopover title={popover.title} body={popover.body} links={popover.links} />
    </div>
  );
}

export function PocActors({ lc }: { lc: PocLifecycle }) {
  const { sessionAccount, team, endowment, connection, sessionCanProposeEndowment } = lc;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <ActorRow
        icon={WalletIcon}
        label="You"
        account={sessionAccount}
        connected={!!sessionAccount}
        popover={{
          title: "You",
          body: "Your SIWN wallet. Submits the application, and as the admin approves it, assigns the pre-deployed pool, and funds the team treasury from this wallet.",
          links: sessionAccount
            ? [
                {
                  label: `${sessionAccount} on nearblocks`,
                  href: nearblocksAccount(sessionAccount),
                },
              ]
            : [],
        }}
      />
      <ActorRow
        icon={GavelIcon}
        label="Team"
        account={team || null}
        connected={connection.daoAccountId === team && !!team}
        popover={{
          title: "Team",
          body: "The DAO linked to your organization. Owns the node's validator pool and the tenant config, stakes its own skin in the game, locks NEAR for its veNEAR, and casts the votes the sponsor's stake buys.",
          links: [
            { label: "Deploy one on trezu.app/create", href: TREZU_CREATE_URL },
            ...(team ? [{ label: `${team} on nearblocks`, href: nearblocksAccount(team) }] : []),
          ],
        }}
      />
      <ActorRow
        icon={StackIcon}
        label="Endowment"
        account={endowment || null}
        connected={
          !!endowment && (sessionCanProposeEndowment || connection.daoAccountId === endowment)
        }
        popover={{
          title: "Endowment (sponsor)",
          body: "A separate treasury that puts up the capital: its NEAR is locked in a veNEAR lockup, staked into the node's pool from that lockup, and all of its voting power is delegated to the team. You connect to it through policy membership — a wallet holding AddProposal rights stages each step as a proposal — or by connecting the treasury itself in Trezu. Its approvers pass the proposals by vote. Optional — it never blocks the team's track.",
          links: endowment
            ? [
                { label: "View proposals on Trezu", href: `https://trezu.app/${endowment}` },
                { label: `${endowment} on nearblocks`, href: nearblocksAccount(endowment) },
              ]
            : [],
        }}
      />
    </div>
  );
}

export function PocTreasuryConnection({ lc }: { lc: PocLifecycle }) {
  const { connection } = lc;
  if (!connection.daoAccountId) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3" data-testid="poc-treasury">
        <span className="text-sm text-muted-foreground">
          No treasury connected.{" "}
          <a
            href={TREZU_CREATE_URL}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Create one on Trezu
          </a>
        </span>
        <Button
          variant="outline"
          onClick={() => void connection.connect().catch(() => {})}
          disabled={connection.status === "connecting"}
          data-testid="poc-connect"
        >
          {connection.status === "connecting" ? "Connecting…" : "Connect a treasury"}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3" data-testid="poc-treasury">
      <span className="min-w-0 text-sm text-muted-foreground">
        Trezu connected as{" "}
        <span className="font-mono break-all text-foreground">{connection.daoAccountId}</span>
      </span>
      <Button
        variant="ghost"
        onClick={() => void connection.disconnect()}
        data-testid="poc-disconnect"
      >
        Disconnect
      </Button>
    </div>
  );
}

export function PocSetupFields({ lc }: { lc: PocLifecycle }) {
  const { form, values, slug, team, connection, connectTeamDaoMutation, connectEndowmentMutation } =
    lc;
  const connecting = connection.status === "connecting";
  return (
    <FieldGroup className="grid sm:grid-cols-2 lg:grid-cols-3">
      <PocFormField form={form} name="name" label="Node name" placeholder="Lisbon Builders" />
      <ReadOnlyField
        id="poc-slug"
        label="Node slug"
        value={slug}
        placeholder="select an organization"
      />
      {team ? (
        <ReadOnlyField id="poc-team" label="Team wallet" value={team} />
      ) : (
        <ConnectField
          id="poc-team"
          label="Team wallet"
          connecting={connectTeamDaoMutation.isPending || connecting}
          onClick={() => connectTeamDaoMutation.mutate()}
          testId="poc-connect-team"
        >
          Connect team DAO
        </ConnectField>
      )}
      <div className="flex flex-col gap-1">
        {values.endowmentLinked ? (
          <ReadOnlyField id="poc-endowment" label="Endowment treasury" value={team} />
        ) : !values.endowment ? (
          <ConnectField
            id="poc-endowment"
            label="Endowment treasury"
            connecting={connectEndowmentMutation.isPending || connecting}
            onClick={() => connectEndowmentMutation.mutate()}
            testId="poc-connect-endowment"
          >
            Connect endowment via Trezu
          </ConnectField>
        ) : (
          <PocFormField form={form} name="endowment" label="Endowment treasury" mono />
        )}
        <Button
          type="button"
          variant="link"
          size="xs"
          className="self-start"
          onClick={() => form.setFieldValue("endowmentLinked", !values.endowmentLinked)}
          data-testid="poc-link-treasuries"
        >
          {values.endowmentLinked ? (
            <>
              <LinkIcon /> Same as team wallet
            </>
          ) : (
            <>
              <LinkBreakIcon /> Separate treasuries
            </>
          )}
        </Button>
      </div>
      <PocFormField
        form={form}
        name="pool"
        label="Staking pool"
        placeholder={POOL_PLACEHOLDER}
        mono
      />
      <PocFormField form={form} name="sponsorAmount" label="Sponsor NEAR" type="number" />
    </FieldGroup>
  );
}
