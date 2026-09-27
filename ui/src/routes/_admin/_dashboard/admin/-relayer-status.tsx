import { Badge } from "@/components";
import type { RelayerInfoData } from "@/lib/use-relayer";
import { RelayerStatusBody } from "./-relayer-status-body";

export function relayerStatus(info: RelayerInfoData | null | undefined) {
  if (!info) return { label: "Not configured", variant: "outline" as const };
  if (info.enabled) return { label: "Active", variant: "success" as const };
  if (info.accountId) return { label: "Needs funding", variant: "destructive" as const };
  return { label: "Starting", variant: "warning" as const };
}

export function RelayerStatus({
  info,
  isLoading,
}: {
  info: RelayerInfoData | null | undefined;
  isLoading: boolean;
}) {
  const status = relayerStatus(info);
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-xl font-semibold text-foreground">Status</h2>
        {!isLoading && (
          <Badge variant={status.variant} data-testid="admin-relayer-status">
            {status.label}
          </Badge>
        )}
        {info?.mode && (
          <Badge variant="outline" className="font-mono">
            {info.mode}
          </Badge>
        )}
      </div>
      <RelayerStatusBody info={info} isLoading={isLoading} />
    </section>
  );
}
