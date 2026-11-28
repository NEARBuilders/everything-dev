import { InfoIcon } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type StatusVariant = "success" | "warning" | "info" | "destructive";

const STATUS_VARIANTS: Record<string, StatusVariant> = {
  accepted: "success",
  proposed: "info",
  superseded: "warning",
  "partially superseded": "warning",
  deprecated: "warning",
  rejected: "destructive",
};

export interface StatusBadgeProps {
  status?: string;
  statusNote?: string;
}

export function StatusBadge({ status, statusNote }: StatusBadgeProps) {
  if (!status) return null;
  const variant = STATUS_VARIANTS[status.toLowerCase()] ?? "info";
  const badge = (
    <Badge
      variant={variant}
      data-testid="docs.status-badge"
      className={statusNote ? "cursor-pointer" : undefined}
    >
      {statusNote && <InfoIcon weight="fill" aria-hidden />}
      <span className="capitalize">{status}</span>
    </Badge>
  );
  if (!statusNote) return badge;
  return (
    <Popover>
      <PopoverTrigger render={badge} aria-label={`Status: ${status}. ${statusNote}`} />
      <PopoverContent align="start" className="w-80 gap-2" data-testid="docs.status-note">
        <p className="text-sm font-medium capitalize">{status}</p>
        <p className="text-muted-foreground">{statusNote}</p>
      </PopoverContent>
    </Popover>
  );
}
