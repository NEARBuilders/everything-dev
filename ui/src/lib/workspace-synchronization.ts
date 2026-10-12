import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { useRouter } from "@tanstack/react-router";
import { Data } from "effect";
import { toast } from "sonner";
import { type AuthClient, sessionQueryKey } from "@/app";
import { teamWorkspaceQueryKey } from "./team-workspace";

export type WorkspaceRefreshStage = "session" | "management" | "workspace" | "router";

export class WorkspaceRefreshError extends Data.TaggedError("WorkspaceRefreshError")<{
  readonly stage: WorkspaceRefreshStage;
  readonly cause: unknown;
}> {
  override get message() {
    return `Workspace refresh failed: ${
      this.cause instanceof Error ? this.cause.message : String(this.cause)
    }`;
  }
}

export interface WorkspaceSynchronizationDependencies {
  auth: Pick<AuthClient, "getSession">;
  queryClient: QueryClient;
  router: Pick<ReturnType<typeof useRouter>, "invalidate">;
}

export interface WorkspaceSynchronizationOptions {
  queryKeys?: readonly QueryKey[];
}

export interface WorkspaceSynchronization {
  synchronize: (options?: WorkspaceSynchronizationOptions) => Promise<void>;
}

function toError(error: unknown) {
  if (error instanceof Error) return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    return new Error(String(error.message));
  }
  return new Error(String(error));
}

export function reportWorkspaceRefreshError(
  error: unknown,
  retry: () => Promise<unknown>,
  onRetryError: (error: Error) => void,
): boolean {
  if (!(error instanceof WorkspaceRefreshError)) return false;
  toast.error(error.message, {
    action: {
      label: "retry refresh",
      onClick: () => {
        void retry().catch((retryError) => onRetryError(toError(retryError)));
      },
    },
  });
  return true;
}

export function createWorkspaceSynchronization({
  auth,
  queryClient,
  router,
}: WorkspaceSynchronizationDependencies): WorkspaceSynchronization {
  const synchronize = async ({ queryKeys = [] }: WorkspaceSynchronizationOptions = {}) => {
    let session: Awaited<ReturnType<AuthClient["getSession"]>>["data"];
    let error: Awaited<ReturnType<AuthClient["getSession"]>>["error"];
    try {
      ({ data: session, error } = await auth.getSession({
        query: { disableCookieCache: true },
      }));
    } catch (error) {
      throw new WorkspaceRefreshError({ stage: "session", cause: error });
    }
    if (error) throw new WorkspaceRefreshError({ stage: "session", cause: toError(error) });

    queryClient.setQueryData(sessionQueryKey, session ?? null);

    try {
      await Promise.all(
        queryKeys.map((queryKey) =>
          queryClient.invalidateQueries(
            { queryKey, refetchType: "active" },
            { throwOnError: true },
          ),
        ),
      );
    } catch (error) {
      throw new WorkspaceRefreshError({ stage: "management", cause: error });
    }

    try {
      await queryClient.invalidateQueries(
        {
          queryKey: teamWorkspaceQueryKey,
          refetchType: "active",
        },
        { throwOnError: true },
      );
    } catch (error) {
      throw new WorkspaceRefreshError({ stage: "workspace", cause: error });
    }

    try {
      await router.invalidate();
    } catch (error) {
      throw new WorkspaceRefreshError({ stage: "router", cause: error });
    }
  };

  return { synchronize };
}
