import { CheckIcon } from "@phosphor-icons/react";
import { cn } from "cn";
import { Button } from "@/components";
import type { PhaseId } from "./-poc-stations";
import type { PhaseProgress } from "./-poc-walkthrough";

export function PocPhaseStepper({
  progress,
  activePhase,
  onSelect,
}: {
  progress: PhaseProgress[];
  activePhase: PhaseId;
  onSelect: (phase: PhaseId) => void;
}) {
  return (
    <nav aria-label="Lifecycle phases" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ol
        className="flex min-w-max gap-2 sm:grid sm:min-w-0 sm:grid-cols-5"
        data-testid="poc-phases"
      >
        {progress.map((entry, index) => {
          const active = entry.phase.id === activePhase;
          return (
            <li key={entry.phase.id} className="flex">
              <Button
                type="button"
                variant={active ? "secondary" : "ghost"}
                className="h-auto w-full justify-start text-left"
                aria-current={active ? "step" : undefined}
                onClick={() => onSelect(entry.phase.id)}
                data-testid={`poc-phase-${entry.phase.id}`}
                data-state={entry.state}
              >
                <span className="flex min-w-0 items-center gap-3 py-2.5">
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                      entry.state === "done"
                        ? "bg-success text-success-foreground"
                        : active
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {entry.state === "done" ? <CheckIcon weight="bold" /> : index + 1}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="leading-tight whitespace-normal">{entry.phase.title}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {entry.done}/{entry.total} done
                    </span>
                  </span>
                </span>
              </Button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
