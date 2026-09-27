import type { ReactNode } from "react";

interface AuthPanelProps {
  icon?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  titleTestId?: string;
  description?: ReactNode;
  descriptionTestId?: string;
  children?: ReactNode;
  footer?: ReactNode;
}

export function AuthPanel({
  icon,
  eyebrow,
  title,
  titleTestId,
  description,
  descriptionTestId,
  children,
  footer,
}: AuthPanelProps) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12 sm:py-20">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <header className="flex flex-col items-center gap-3 text-center">
          {icon && (
            <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-foreground [&_svg]:size-7">
              {icon}
            </div>
          )}
          {eyebrow && <div className="text-sm font-medium text-muted-foreground">{eyebrow}</div>}
          <h1
            className="text-3xl font-semibold wrap-anywhere text-foreground"
            data-testid={titleTestId}
          >
            {title}
          </h1>
          {description && (
            <p
              className="text-base wrap-break-word text-muted-foreground"
              data-testid={descriptionTestId}
            >
              {description}
            </p>
          )}
        </header>
        {children}
        {footer && (
          <div className="flex flex-wrap items-center justify-center gap-1 text-sm text-muted-foreground">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
