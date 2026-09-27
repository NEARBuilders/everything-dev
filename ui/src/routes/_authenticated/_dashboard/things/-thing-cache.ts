import type { QueryClient } from "@tanstack/react-query";

export const thingQueryKeys = {
  list: ["things-list"] as const,
  detail: (thingId: string) => ["thing", thingId] as const,
};

export function invalidateThingAfterDelete(queryClient: QueryClient, thingId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: thingQueryKeys.list, exact: true }),
    queryClient.invalidateQueries({ queryKey: thingQueryKeys.detail(thingId), exact: true }),
  ]);
}
