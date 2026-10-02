import type { ReactNode } from "react";

export function SettingsRow({
  label,
  description,
  children,
  action,
  testId,
}: {
  label: string;
  description?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border py-4 last:border-b-0"
      data-testid={testId}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:w-1/3 sm:flex-none">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {description && <span className="text-sm text-muted-foreground">{description}</span>}
      </div>
      <div className="order-last w-full min-w-0 text-sm break-words text-foreground sm:order-none sm:w-auto sm:flex-1">
        {children}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
