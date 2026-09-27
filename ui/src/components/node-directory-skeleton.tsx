import { cn } from "cn";
import { Skeleton } from "./ui/skeleton";

export function NodeDirectorySkeleton({ layout = "list" }: { layout?: "list" | "grid" }) {
  const grid = layout === "grid";
  return (
    <div
      role="status"
      aria-label="Loading communities"
      className={cn(
        grid
          ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          : "flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border",
      )}
    >
      {Array.from({ length: grid ? 6 : 3 }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "flex min-h-16 items-center gap-4",
            grid ? "rounded-2xl border border-border p-4" : "px-4 py-3",
          )}
        >
          <Skeleton className="size-10 rounded-xl" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-44" />
          </div>
          <Skeleton className="h-5 w-14" />
        </div>
      ))}
    </div>
  );
}
