import type { ReactNode } from "react";

interface SectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  sectionTestId?: string;
}

export function SectionHeader({ title, description, action, sectionTestId }: SectionHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h2
          className="text-xl font-semibold wrap-anywhere text-foreground"
          data-testid={sectionTestId}
        >
          {title}
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
