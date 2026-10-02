import { Skeleton } from "@/components/ui/skeleton";

export function StakeSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-5" data-testid="stake.loading">
      <div className="flex flex-col gap-3 lg:col-span-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-20 w-full rounded-2xl" />
      </div>
      <Skeleton className="h-64 w-full rounded-4xl lg:col-span-2" />
    </div>
  );
}
