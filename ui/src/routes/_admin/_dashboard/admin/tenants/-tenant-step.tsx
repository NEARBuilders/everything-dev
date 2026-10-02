import { CheckIcon, XIcon } from "@phosphor-icons/react";
import { cn } from "cn";
import type { ReactNode } from "react";
import { Button } from "@/components";
import type { TenantWizardStepStatus } from "./-tenant-wizard";

export function TenantStep({
  id,
  number,
  title,
  status,
  summary,
  last = false,
  onChange,
  children,
}: {
  id: string;
  number: number;
  title: string;
  status: TenantWizardStepStatus | "failed";
  summary?: ReactNode;
  last?: boolean;
  onChange?: () => void;
  children?: ReactNode;
}) {
  return (
    <li className="flex gap-4" data-testid={`admin-tenant-step-${id}`} data-status={status}>
      <div className="flex flex-col items-center">
        <span
          aria-hidden
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-medium",
            status === "complete" && "bg-success-muted text-success-muted-foreground",
            status === "current" && "bg-primary text-primary-foreground",
            status === "upcoming" && "border border-border text-muted-foreground",
            status === "failed" && "bg-destructive-muted text-destructive-muted-foreground",
          )}
        >
          {status === "complete" ? (
            <CheckIcon className="size-4" weight="bold" />
          ) : status === "failed" ? (
            <XIcon className="size-4" weight="bold" />
          ) : (
            number
          )}
        </span>
        {!last && <span aria-hidden className="mt-2 w-px flex-1 bg-border" />}
      </div>
      <div className={cn("flex min-w-0 flex-1 flex-col gap-5", !last && "pb-10")}>
        <div className="flex min-h-8 items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <h2
              className={cn(
                "text-lg font-medium",
                status === "upcoming" ? "text-muted-foreground" : "text-foreground",
              )}
            >
              <span className="sr-only">
                {`Step ${number}${status === "complete" ? ", done" : ""}: `}
              </span>
              {title}
            </h2>
            {status === "complete" && summary && (
              <p className="truncate text-sm text-muted-foreground">{summary}</p>
            )}
          </div>
          {status === "complete" && onChange && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid={`admin-tenant-step-${id}-change`}
              onClick={onChange}
            >
              Change
            </Button>
          )}
        </div>
        {(status === "current" || status === "failed") && children}
      </div>
    </li>
  );
}
