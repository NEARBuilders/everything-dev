import type { QueryClient } from "@tanstack/react-query";
import { invalidateNodeQueries } from "@/lib/queries/nodes";
import { invalidateTenantQueries } from "@/lib/queries/tenants";

export type PersistedTenantChange<T> = {
  updated: T;
  publicationError: Error | null;
};

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

export async function publishPersistedTenantChange<T>(
  updated: T,
  publish: () => Promise<unknown>,
): Promise<PersistedTenantChange<T>> {
  try {
    await publish();
    return { updated, publicationError: null };
  } catch (error) {
    return { updated, publicationError: toError(error) };
  }
}

export async function invalidatePersistedTenantQueries(queryClient: QueryClient) {
  try {
    await Promise.all([invalidateNodeQueries(queryClient), invalidateTenantQueries(queryClient)]);
    return null;
  } catch (error) {
    return toError(error);
  }
}
