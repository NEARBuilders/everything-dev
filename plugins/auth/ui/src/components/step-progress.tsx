import { cn } from "@/lib/utils";

interface StepProgressProps {
  steps: readonly string[];
  current: number;
  testId?: string;
}

export function StepProgress({ steps, current, testId }: StepProgressProps) {
  return (
    <div className="flex flex-col gap-2" data-testid={testId} data-step={current + 1}>
      <ol className="flex gap-2" aria-label="Progress">
        {steps.map((step, index) => (
          <li
            key={step}
            aria-current={index === current ? "step" : undefined}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              index <= current ? "bg-primary" : "bg-muted",
            )}
          >
            <span className="sr-only">{step}</span>
          </li>
        ))}
      </ol>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-foreground">{steps[current]}</span>
        <span className="text-muted-foreground">
          Step {current + 1} of {steps.length}
        </span>
      </div>
    </div>
  );
}
