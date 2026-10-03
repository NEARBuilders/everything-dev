import type { ReactNode } from "react";

interface AuthPanelProps {
  icon?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  titleTestId?: string;
  description?: ReactNode;
  descriptionTestId?: string;
  toolbar?: ReactNode;
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
  toolbar,
  children,
  footer,
}: AuthPanelProps) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain px-4 py-12 sm:py-20"
      data-testid="auth-panel"
    >
      <div className="mx-auto my-auto flex w-full max-w-sm flex-col gap-8">
        {toolbar && <div className="flex justify-end">{toolbar}</div>}
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
