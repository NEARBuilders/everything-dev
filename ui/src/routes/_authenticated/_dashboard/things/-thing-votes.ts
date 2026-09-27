export function optimisticUpvoteCount(currentCount: number | undefined, nextHasUpvote: boolean) {
  const resolvedCount = currentCount ?? 0;
  return Math.max(0, resolvedCount + (nextHasUpvote ? 1 : -1));
}
