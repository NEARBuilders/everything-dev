import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { CheckIcon, CopyIcon, MinusIcon, XIcon } from "@phosphor-icons/react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import type * as React from "react";
import { createContext, type ReactElement, type ReactNode, useContext, useState } from "react";

export type RetroIntensity = "soft" | "classic" | "tycoon";

const RetroContext = createContext<RetroIntensity>("classic");

export function RetroProvider({
  intensity,
  children,
}: {
  intensity: RetroIntensity;
  children: ReactNode;
}) {
  return <RetroContext.Provider value={intensity}>{children}</RetroContext.Provider>;
}

export function useRetroIntensity() {
  return useContext(RetroContext);
}

const retroButtonVariants = cva(
  "group/button relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-none font-medium whitespace-nowrap select-none outline-none transition-bevel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring retro-classic:focus-visible:outline-1 retro-classic:focus-visible:outline-dotted retro-classic:focus-visible:outline-offset-[-6px] retro-classic:focus-visible:outline-current retro-tycoon:font-heading retro-tycoon:font-semibold retro-tycoon:active:not-disabled:press-shift-button retro-tycoon:data-pressed:press-shift-button disabled:cursor-default disabled:bg-face disabled:text-muted-foreground disabled:text-emboss [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground bevel-raised active:not-disabled:bevel-pressed data-pressed:bevel-pressed retro-soft:hover:bg-primary/90",
        brand:
          "bg-brand text-brand-foreground bevel-raised active:not-disabled:bevel-pressed data-pressed:bevel-pressed retro-soft:hover:bg-brand/90",
        outline:
          "bg-face text-foreground bevel-raised active:not-disabled:bevel-pressed data-pressed:bevel-pressed retro-soft:hover:bg-accent retro-classic:data-pressed:bg-dither",
        secondary:
          "bg-card text-card-foreground bevel-raised active:not-disabled:bevel-pressed data-pressed:bevel-pressed retro-soft:hover:bg-muted",
        ghost:
          "bg-transparent text-foreground bevel-none hover:bevel-raised active:not-disabled:bevel-pressed data-pressed:bevel-pressed retro-soft:hover:bg-muted retro-soft:data-pressed:bg-accent retro-classic:data-pressed:bg-dither retro-tycoon:data-pressed:bg-face retro-tycoon:active:not-disabled:press-shift-label disabled:bg-transparent",
        destructive:
          "bg-destructive text-destructive-foreground bevel-raised active:not-disabled:bevel-pressed data-pressed:bevel-pressed retro-soft:hover:bg-destructive/90",
      },
      size: {
        sm: "h-9 gap-1.5 px-3 text-sm",
        default: "h-11 gap-2 px-5 text-base",
        lg: "h-12 gap-2 px-6 text-base [&_svg:not([class*='size-'])]:size-5",
        xl: "h-14 gap-2.5 px-8 text-lg [&_svg:not([class*='size-'])]:size-5",
        icon: "size-11",
        "icon-sm": "size-9",
        titlebar: "size-7 [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type RetroButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof retroButtonVariants> & { pressed?: boolean };

export function RetroButton({
  className,
  variant,
  size,
  pressed,
  children,
  ...props
}: RetroButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="retro-button"
      data-pressed={pressed || undefined}
      aria-pressed={pressed}
      className={cn(retroButtonVariants({ variant, size }), className)}
      {...props}
    >
      <span className="inline-flex min-w-0 items-center justify-center gap-[inherit] transition-bevel group-active/button:press-shift-label group-data-pressed/button:press-shift-label">
        {children}
      </span>
    </ButtonPrimitive>
  );
}

export function RetroWindow({
  title,
  icon,
  onClose,
  chrome = true,
  actions,
  className,
  bodyClassName,
  children,
  ...props
}: Omit<React.ComponentProps<"section">, "title"> & {
  title: ReactNode;
  icon?: ReactNode;
  onClose?: () => void;
  chrome?: boolean;
  actions?: ReactNode;
  bodyClassName?: string;
}) {
  const intensity = useRetroIntensity();
  const showChrome = chrome && intensity !== "soft";
  return (
    <section
      data-slot="retro-window"
      className={cn(
        "flex min-w-0 flex-col bg-card p-window text-card-foreground bevel-window retro-classic:bg-face retro-tycoon:bg-face",
        className,
      )}
      {...props}
    >
      <header className="flex h-10 shrink-0 items-center gap-2 bg-titlebar pr-1.5 pl-3 text-sm font-semibold retro-soft:h-12 retro-soft:border-b retro-soft:border-border retro-soft:pr-3 retro-soft:pl-5 retro-soft:font-medium retro-tycoon:h-12 retro-tycoon:pl-4 retro-tycoon:font-heading retro-tycoon:text-base [&_svg:not([class*='size-'])]:size-4">
        {icon}
        <div className="min-w-0 flex-1 truncate">{title}</div>
        {actions}
        {showChrome && (
          <RetroButton variant="outline" size="titlebar" aria-hidden tabIndex={-1}>
            <MinusIcon weight="bold" />
          </RetroButton>
        )}
        {onClose &&
          (intensity === "soft" ? (
            <RetroButton variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
              <XIcon />
            </RetroButton>
          ) : (
            <RetroButton variant="outline" size="titlebar" onClick={onClose} aria-label="Close">
              <XIcon weight="bold" />
            </RetroButton>
          ))}
      </header>
      <div
        className={cn(
          "flex min-w-0 flex-col gap-6 p-6 retro-classic:p-5 retro-tycoon:p-6",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function RetroSunken({
  className,
  variant = "panel",
  ...props
}: React.ComponentProps<"div"> & { variant?: "panel" | "list" }) {
  return (
    <div
      data-slot="retro-sunken"
      data-variant={variant}
      className={cn(
        "min-w-0 bg-background bevel-sunken data-[variant=list]:flex data-[variant=list]:flex-col data-[variant=list]:divide-y data-[variant=list]:divide-border",
        className,
      )}
      {...props}
    />
  );
}

export function RetroRule({ className }: { className?: string }) {
  return (
    <div
      data-slot="retro-rule"
      aria-hidden
      className={cn(
        "h-0.5 min-w-4 flex-1 bevel-sunken retro-soft:h-px retro-soft:bg-border retro-soft:bevel-none",
        className,
      )}
    />
  );
}

export function RetroInput({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="retro-input"
      className={cn(
        "h-11 w-full min-w-0 rounded-none bg-background px-3 text-base bevel-sunken outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:bg-face disabled:text-muted-foreground retro-tycoon:h-12 retro-tycoon:px-4",
        className,
      )}
      {...props}
    />
  );
}

export function RetroTextarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="retro-textarea"
      className={cn(
        "field-sizing-content min-h-24 w-full min-w-0 resize-none rounded-none bg-background px-3 py-2.5 text-base bevel-sunken outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
      {...props}
    />
  );
}

export function RetroLabel({ className, ...props }: React.ComponentProps<"label">) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: prototype primitive, control passed by caller
    <label
      data-slot="retro-label"
      className={cn("text-sm font-medium text-foreground", className)}
      {...props}
    />
  );
}

export function useCopy(timeout = 1600) {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), timeout);
  };
  return { copied, copy };
}

export function RetroCode({
  children,
  copyable = true,
  className,
}: {
  children: string;
  copyable?: boolean;
  className?: string;
}) {
  const { copied, copy } = useCopy();
  return (
    <RetroSunken className={cn("flex items-start gap-2 p-1.5 pl-3", className)}>
      <pre className="min-w-0 flex-1 overflow-x-auto py-1.5 font-mono text-sm leading-6 break-all whitespace-pre-wrap text-foreground">
        {children}
      </pre>
      {copyable && (
        <RetroButton
          variant="ghost"
          size="icon-sm"
          onClick={() => copy(children)}
          aria-label={copied ? "Copied" : "Copy"}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </RetroButton>
      )}
    </RetroSunken>
  );
}

const retroBadgeVariants = cva(
  "inline-flex h-6 shrink-0 items-center gap-1 px-2 text-xs font-medium whitespace-nowrap [&_svg]:size-3.5 retro-tycoon:h-7 retro-tycoon:font-semibold",
  {
    variants: {
      variant: {
        neutral: "bg-face text-muted-foreground bevel-raised",
        success: "bg-success-muted text-success-muted-foreground bevel-raised",
        warning: "bg-warning-muted text-warning-muted-foreground bevel-raised",
        info: "bg-info-muted text-info-muted-foreground bevel-raised",
        brand: "bg-brand-muted text-brand-strong bevel-raised",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export function RetroBadge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof retroBadgeVariants>) {
  return <span className={cn(retroBadgeVariants({ variant }), className)} {...props} />;
}

export function RetroDialog({
  open,
  onOpenChange,
  trigger,
  title,
  icon,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: ReactElement;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogPrimitive.Trigger render={trigger} />}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 ease-out data-ending-style:opacity-0 data-ending-style:duration-150 data-starting-style:opacity-0" />
        <DialogPrimitive.Popup
          data-slot="retro-dialog"
          className="fixed inset-x-0 bottom-0 z-50 pb-[env(safe-area-inset-bottom)] outline-none transition-[translate,scale,opacity] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:duration-150 max-sm:data-ending-style:translate-y-full max-sm:data-starting-style:translate-y-full sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:pb-0 sm:data-ending-style:scale-97 sm:data-ending-style:opacity-0 sm:data-starting-style:scale-97 sm:data-starting-style:opacity-0"
        >
          <RetroWindow
            title={
              <DialogPrimitive.Title className="truncate text-inherit">
                {title}
              </DialogPrimitive.Title>
            }
            icon={icon}
            onClose={() => onOpenChange(false)}
          >
            {children}
          </RetroWindow>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
