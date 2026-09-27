import { UsersThreeIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import {
  connectDaoAccount,
  disconnectDaoAccount,
  fetchDaoMembership,
  type ParsedDaoMembership,
  useDaoAutoRestore,
  useDaoConnection,
} from "@/lib/dao-connect";
import { useNearAccount } from "@/lib/use-near-account";

export type ConnectDaoPurpose =
  | "apply"
  | "tenant-create"
  | "tenant-deploy"
  | "proposal-review"
  | "community-settings";

interface ConnectDaoProps {
  onVerified?: (info: { daoAccountId: string; membership: ParsedDaoMembership }) => void;
  purpose?: ConnectDaoPurpose;
  variant?: "card" | "plain";
}

type MembershipState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok" }
  | { kind: "not-member" }
  | { kind: "not-sputnik" }
  | { kind: "error"; message: string };

const purposeCopy: Record<ConnectDaoPurpose | "default", string> = {
  default: "Sign in as the DAO that owns this community, through Trezu.",
  apply: "Your DAO will own the community. Sign in as the DAO through Trezu.",
  "tenant-create": "The community's settings are published under this DAO's account.",
  "tenant-deploy": "Publishing needs the DAO to sign. Keep it connected until deploy finishes.",
  "proposal-review": "Approving creates the community and asks this DAO to publish its settings.",
  "community-settings": "Changes to this community are signed by its DAO.",
};

async function handleConnect(authAccountId: string | null) {
  try {
    await connectDaoAccount({ authAccountId: authAccountId ?? undefined });
  } catch {}
}

async function handleDisconnect() {
  await disconnectDaoAccount();
}

export function ConnectDao({ onVerified, purpose, variant = "card" }: ConnectDaoProps) {
  const primaryAccountId = useNearAccount();
  useDaoAutoRestore(primaryAccountId);
  const connection = useDaoConnection();
  const [membership, setMembership] = useState<MembershipState>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (connection.status !== "connected" || !connection.daoAccountId || !primaryAccountId) {
        setMembership({ kind: "idle" });
        return;
      }
      setMembership({ kind: "loading" });
      try {
        const result = await fetchDaoMembership(connection.daoAccountId, primaryAccountId);
        if (cancelled) return;
        if (!result.isSputnikContract) {
          setMembership({ kind: "not-sputnik" });
          return;
        }
        if (!result.isMember) {
          setMembership({ kind: "not-member" });
          return;
        }
        setMembership({ kind: "ok" });
        onVerified?.({ daoAccountId: connection.daoAccountId, membership: result });
      } catch (err) {
        if (cancelled) return;
        setMembership({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [connection.status, connection.daoAccountId, primaryAccountId, onVerified]);

  const connected = connection.status === "connected" && !!connection.daoAccountId;
  const connecting = connection.status === "connecting";

  return (
    <div className="flex flex-col gap-2" data-testid="dao-connect">
      <Item variant={variant === "card" ? "outline" : "muted"}>
        <ItemMedia variant="icon">
          <UsersThreeIcon />
        </ItemMedia>
        <ItemContent className="min-w-0">
          {connected ? (
            <>
              <ItemTitle data-testid="dao-connect-account">
                <code className="truncate font-mono">{connection.daoAccountId}</code>
              </ItemTitle>
              <MembershipLine state={membership} primaryAccountId={primaryAccountId} />
            </>
          ) : (
            <>
              <ItemTitle>Connect your DAO</ItemTitle>
              <ItemDescription>{purposeCopy[purpose ?? "default"]}</ItemDescription>
            </>
          )}
        </ItemContent>
        <ItemActions>
          {connected ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="dao-connect-disconnect"
              onClick={() => void handleDisconnect()}
            >
              Disconnect
            </Button>
          ) : (
            <Button
              type="button"
              variant={variant === "plain" ? "default" : "outline"}
              data-testid="dao-connect-button"
              onClick={() => void handleConnect(primaryAccountId)}
              disabled={connecting}
            >
              {connecting && <Spinner />}
              {connecting ? "Opening Trezu…" : "Connect with Trezu"}
            </Button>
          )}
        </ItemActions>
      </Item>
      {!connected && connection.status === "error" && connection.error && (
        <p role="alert" className="text-sm text-destructive">
          {connection.error}
        </p>
      )}
    </div>
  );
}

function MembershipLine({
  state,
  primaryAccountId,
}: {
  state: MembershipState;
  primaryAccountId: string | null;
}) {
  if (state.kind === "idle") return null;
  if (state.kind === "loading") {
    return (
      <div
        className="flex items-center gap-2 text-sm text-muted-foreground"
        data-testid="dao-connect-status"
      >
        <Spinner />
        Checking membership…
      </div>
    );
  }
  if (state.kind === "ok") {
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="dao-connect-status">
        <Badge variant="success">Member</Badge>
        {primaryAccountId && (
          <span className="truncate text-sm text-muted-foreground">{primaryAccountId}</span>
        )}
      </div>
    );
  }
  const message =
    state.kind === "not-member"
      ? `${primaryAccountId ?? "Your NEAR account"} isn't a member of this DAO`
      : state.kind === "not-sputnik"
        ? "This account isn't a Sputnik DAO"
        : `Couldn't check membership: ${state.message}`;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="dao-connect-status">
      <Badge variant="destructive">
        {state.kind === "error" ? "Check failed" : "Not verified"}
      </Badge>
      <span className="text-sm text-muted-foreground">{message}</span>
    </div>
  );
}
