import { ArrowSquareOutIcon, InfoIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface InfoPopoverLink {
  label: string;
  href: string;
}

interface InfoPopoverProps {
  title: string;
  body?: ReactNode;
  links?: InfoPopoverLink[];
  className?: string;
  testId?: string;
  label?: string;
  /** Replaces the default Info icon in the trigger. */
  icon?: ReactNode;
}

export function InfoPopover({
  title,
  body,
  links,
  className,
  testId,
  label,
  icon,
}: InfoPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size={label ? "xs" : "icon-xs"}
            className={cn("shrink-0", className)}
          />
        }
        aria-label={label ?? `about ${title}`}
        data-testid={testId}
      >
        {icon ?? <InfoIcon className="h-3.5 w-3.5" />}
        {label ? <span>{label}</span> : null}
      </PopoverTrigger>
      <PopoverContent>
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        {body ? <div className="text-xs leading-relaxed text-foreground">{body}</div> : null}
        {links && links.length > 0 ? (
          <div className="flex flex-col gap-1 border-t border-border pt-2">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground underline hover:text-foreground"
              >
                {link.label}
                <ArrowSquareOutIcon className="h-3 w-3 shrink-0" />
              </a>
            ))}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
