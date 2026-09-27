import { CheckCircleIcon, GearSixIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { pluginPath, type SessionData } from "@/app";
import { Avatar, AvatarFallback, AvatarImage, Badge, Button, Card } from "@/components";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]?.[0]}${parts[1]?.[0]}` : name.slice(0, 2)).toUpperCase();
}

function MethodRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      {value ? (
        <span className="flex min-w-0 items-center gap-1.5 text-sm">
          <CheckCircleIcon className="size-4 shrink-0 text-success" />
          <span className="truncate">{value}</span>
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">Not added</span>
      )}
    </div>
  );
}

export function IdentityCard({
  user,
  nearAccountId,
  passkeyCount,
}: {
  user: SessionData["user"];
  nearAccountId: string | null;
  passkeyCount: number;
}) {
  const name = user.name || nearAccountId || "You";
  const realEmail = user.email && !user.email.startsWith("temp-") ? user.email : null;
  return (
    <Card className="gap-4 px-6" data-testid="home-identity">
      <div className="flex items-center gap-3">
        <Avatar size="lg">
          {user.image && <AvatarImage src={user.image} alt="" />}
          <AvatarFallback>{initials(name)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate font-medium">{name}</span>
          {user.isAnonymous ? (
            <Badge variant="warning">Guest account</Badge>
          ) : (
            <span className="truncate text-sm text-muted-foreground">
              {nearAccountId ?? realEmail ?? "Signed in"}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col divide-y divide-border">
        <MethodRow label="Passkey" value={passkeyCount > 0 ? `${passkeyCount} added` : null} />
        <MethodRow label="NEAR wallet" value={nearAccountId} />
        {realEmail && <MethodRow label="Email" value={realEmail} />}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        nativeButton={false}
        render={<Link to={pluginPath("/settings")} preload="intent" />}
        data-testid="home-settings-link"
      >
        <GearSixIcon />
        Settings
      </Button>
    </Card>
  );
}
