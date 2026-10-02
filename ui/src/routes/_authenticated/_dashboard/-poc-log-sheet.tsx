import { ListBulletsIcon } from "@phosphor-icons/react";
import { Badge, Button, LocalDate } from "@/components";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { LogEntry } from "./-poc-lifecycle";

export function PocLogSheet({ entries }: { entries: LogEntry[] }) {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" data-testid="poc-log-open" />}>
        <ListBulletsIcon />
        Chain log
        {entries.length > 0 && <Badge variant="secondary">{entries.length}</Badge>}
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle data-testid="poc-log">Chain log</SheetTitle>
          <SheetDescription>Everything signed from this page, newest first.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-6">
          {entries.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No actions signed yet.
            </p>
          ) : (
            <ol className="flex flex-col gap-4" data-testid="poc-log-entries">
              {entries.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">
                    <LocalDate value={entry.at} format="time" />
                  </span>
                  <span className="text-sm text-foreground">{entry.label}</span>
                  {entry.detail && (
                    <span className="font-mono text-xs break-all text-muted-foreground">
                      {entry.detail}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
