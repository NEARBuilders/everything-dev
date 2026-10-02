import { cn } from "cn";
import type { ReactNode } from "react";

interface ChipProps {
  children: ReactNode;
  accent?: boolean;
  muted?: boolean;
  className?: string;
}

export function Chip({ children, accent, muted, className }: ChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        accent
          ? "bg-brand-muted text-brand-strong"
          : muted
            ? "bg-muted text-muted-foreground"
            : "bg-secondary text-secondary-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}
