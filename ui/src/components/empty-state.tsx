import { cn } from "cn";
import type { ComponentType, ReactNode } from "react";

interface EmptyStateProps {
  icon?: ComponentType<{ size?: number; className?: string }>;
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-4 py-20", className)}>
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        {Icon && (
          <div className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Icon size={28} />
          </div>
        )}
        {title && <h2 className="text-xl font-semibold text-foreground">{title}</h2>}
        {description && <div className="text-base text-muted-foreground">{description}</div>}
        {action && <div className="flex flex-wrap justify-center gap-3 pt-2">{action}</div>}
      </div>
    </div>
  );
}
