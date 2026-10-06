import { XIcon } from "@phosphor-icons/react";
import { cn } from "cn";
import type * as React from "react";
import { Button } from "@/components/ui/button";

function Window({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="window"
      className={cn(
        "flex min-w-0 flex-col bg-card p-window text-card-foreground bevel-window",
        className,
      )}
      {...props}
    />
  );
}

function WindowTitleBar({
  className,
  icon,
  actions,
  onClose,
  closeLabel = "Close",
  children,
  ...props
}: React.ComponentProps<"header"> & {
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  onClose?: () => void;
  closeLabel?: string;
}) {
  return (
    <header
      data-slot="window-title-bar"
      className={cn(
        "flex h-12 shrink-0 items-center gap-2 border-b border-border bg-titlebar pr-3 pl-5 text-sm font-medium [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {icon}
      <div className="min-w-0 flex-1 truncate">{children}</div>
      {actions}
      {onClose && (
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={closeLabel}>
          <XIcon />
        </Button>
      )}
    </header>
  );
}

function WindowBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="window-body"
      className={cn("flex min-w-0 flex-col gap-6 p-6", className)}
      {...props}
    />
  );
}

export { Window, WindowBody, WindowTitleBar };
