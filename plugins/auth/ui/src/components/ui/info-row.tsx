import { cn } from "cn";
import type { ReactNode } from "react";

export function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-border py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn("text-sm break-all text-foreground sm:text-right", mono && "font-mono")}>
        {value}
      </span>
    </div>
  );
}
