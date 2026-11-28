import { queryOptions } from "@tanstack/react-query";

export interface VersionEndpointResponse {
  deploymentDigest?: string;
  remotes?: Record<string, string>;
  watch?: { lastOutcome?: string };
}

export function deployedVersionQueryOptions() {
  return queryOptions({
    queryKey: ["deployed-version"],
    queryFn: async (): Promise<VersionEndpointResponse> => {
      const response = await fetch("/.well-known/version");
      if (!response.ok) throw new Error(`version endpoint returned ${response.status}`);
      return response.json();
    },
    refetchInterval: 30_000,
  });
}
