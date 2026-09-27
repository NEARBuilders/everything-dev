import type { ComponentType, ReactNode } from "react";

interface PageHeaderProps {
  icon?: ComponentType<{ className?: string }>;
  label?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  headerTestId?: string;
}

export function PageHeader({
  icon: Icon,
  label,
  title,
  subtitle,
  description,
  actions,
  headerTestId,
}: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4" data-testid={headerTestId}>
      {label && (
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          {Icon && <Icon className="size-4" />}
          {label}
        </div>
      )}
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-3">
          <h1 className="text-3xl font-semibold wrap-anywhere text-foreground sm:text-4xl">
            {title}
          </h1>
          {subtitle && (
            <div className="font-mono text-sm break-all text-muted-foreground">{subtitle}</div>
          )}
          {description && (
            <p className="max-w-2xl text-base text-muted-foreground sm:text-lg">{description}</p>
          )}
        </div>
        {actions && <div className="flex flex-wrap gap-3 sm:shrink-0">{actions}</div>}
      </div>
    </header>
  );
}
