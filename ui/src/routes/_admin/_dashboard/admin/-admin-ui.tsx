import { ArrowLeftIcon, CaretDownIcon, CaretRightIcon, DotsThreeIcon } from "@phosphor-icons/react";
import { Link, type LinkProps } from "@tanstack/react-router";
import { cn } from "cn";
import { type ReactNode, useState } from "react";
import { Button, Skeleton } from "@/components";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type StatusTone = "success" | "warning" | "destructive" | "secondary" | "outline";

export function tenantStatusTone(status: string): StatusTone {
  if (status === "active") return "success";
  if (status === "suspended") return "destructive";
  if (status === "pending" || status === "pending_deletion") return "warning";
  return "outline";
}

export function humanize(value: string) {
  const text = value.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function BackLink({ to, children }: { to: LinkProps["to"]; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-2 hover:text-foreground"
      data-testid="admin-back-link"
    >
      <ArrowLeftIcon className="size-4" />
      {children}
    </Link>
  );
}

export function StatFigure({
  label,
  value,
  hint,
  testId,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  testId?: string;
  tone?: "default" | "attention";
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid={testId}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={cn(
          "truncate font-heading text-4xl font-semibold tabular-nums",
          tone === "attention" ? "text-brand-strong" : "text-foreground",
        )}
      >
        {value}
      </span>
      {hint && <span className="truncate text-sm text-muted-foreground">{hint}</span>}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <section className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">{children}</section>;
}

export interface RowMenuAction {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
  testId?: string;
}

export function RowMenu({ label, actions }: { label: string; actions: RowMenuAction[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label={label} data-testid="admin-row-menu" />
        }
      >
        <DotsThreeIcon weight="bold" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.label}
            variant={action.destructive ? "destructive" : "default"}
            disabled={action.disabled}
            onClick={action.onSelect}
            data-testid={action.testId}
          >
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-14 w-full" />
      ))}
    </div>
  );
}

export function RawJson({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-2xl bg-muted p-4 font-mono text-xs text-foreground">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function RawJsonDisclosure({
  value,
  label = "raw JSON",
  testId,
}: {
  value: unknown;
  label?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        data-testid={testId}
      >
        {open ? <CaretDownIcon /> : <CaretRightIcon />}
        {open ? `Hide ${label}` : `Show ${label}`}
      </Button>
      {open && <RawJson value={value} />}
    </div>
  );
}

export function formatNearFigure(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return String(value);
  return amount.toFixed(2).replace(/\.?0+$/, "") || "0";
}
