import { queryOptions } from "@tanstack/react-query";
import type { DocsApiClient } from "./api";

export const docsKeys = {
  nav: ["docs", "nav"] as const,
};

export const docsNavQueryOptions = (client: DocsApiClient) =>
  queryOptions({
    queryKey: docsKeys.nav,
    queryFn: () => client.getNav().then((result) => result.nav),
  });
