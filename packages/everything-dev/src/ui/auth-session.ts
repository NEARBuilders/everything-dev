import type { QueryClient } from "@tanstack/react-query";
import type { AuthClient, SessionData } from "./auth";

/**
 * The session-cache primitives, free of better-auth client imports — mount
 * guards reach them through the manifest composition surface, whose import
 * graph must stay resolvable in a bare `everything-dev` install. Types come
 * in erased; the runtime surface is query plumbing only.
 */
export const sessionQueryKey = ["session"] as const;

export function sessionQueryOptions(authClient: AuthClient) {
  return {
    queryKey: sessionQueryKey,
    queryFn: async () => {
      try {
        const { data: session, error } = await authClient.getSession({
          query: { disableCookieCache: true },
        });
        if (error) {
          const record = error as { message?: string; detail?: string; detailFull?: string };
          throw Object.assign(new Error(record.message || "Unable to load your session"), {
            detail: [record.detail, record.detailFull].find(
              (value) => typeof value === "string" && value.trim() !== "",
            ),
          });
        }
        return session ?? null;
      } catch (error) {
        // SSR degrade, don't 500 (#689): the session read shares the
        // visitor's page render — an edge-blocked or failing auth call must
        // render the page signed-out, not fail the whole document. The
        // client surface keeps throwing so the UI can surface auth outages.
        if (typeof window === "undefined") {
          console.warn(
            `[Session] SSR session fetch failed — rendering signed-out: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return null;
        }
        throw error;
      }
    },
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
  };
}

export async function refreshSessionCache(
  authClient: AuthClient,
  queryClient: QueryClient,
): Promise<SessionData | null> {
  return queryClient.fetchQuery({ ...sessionQueryOptions(authClient), staleTime: 0 });
}
