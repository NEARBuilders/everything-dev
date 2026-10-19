import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { Clock, Context, Effect, Layer, Schedule, ScopedCache } from "effect";
import type { BosEnv } from "everything-dev/config";
import {
  type EntrySlot,
  entryUrls,
  UI_REMOTE_SERVER_ENTRY_FILENAME,
} from "everything-dev/ui/manifest";
import { FederationError } from "../errors";
import { type LocalDistServer, startLocalDistServer } from "../local-dist-server";

const LOCAL_CONTAINER_READY_POLL_MS = 300;
const LOCAL_CONTAINER_READY_TIMEOUT_MS = 120_000;

const runFetch = (url: string, init?: RequestInit): Promise<Response> => fetch(url, init);

/**
 * Dev-only loopback servers for built node containers, behind a ScopedCache:
 * each server's lifetime is its cache entry's scope — stopping the server is
 * the entry finalizer, expiry/eviction releases one server, and the whole
 * cache closes with the host runtime scope. No global disposal.
 */
export class FederationContainers extends Context.Service<
  FederationContainers,
  {
    /** The local ui source's built node container over loopback HTTP — the
     * SAME remote-loading flow as production. One server per local root. */
    readonly localUiRemoteEntry: (source: {
      name: string;
      localRoot: string;
    }) => Effect.Effect<EntrySlot, FederationError>;
  }
>()("host/services/federation/FederationContainers") {
  static readonly layer = Layer.effect(
    FederationContainers,
    Effect.gen(function* () {
      const servers = yield* ScopedCache.make<string, LocalDistServer, FederationError>({
        capacity: 64,
        lookup: (localRoot) =>
          Effect.acquireRelease(
            Effect.tryPromise({
              try: () => startLocalDistServer(path.join(localRoot, "dist")),
              catch: (cause) =>
                new FederationError({
                  remoteName: localRoot,
                  cause: new Error(`failed to start local dist server: ${String(cause)}`),
                }),
            }),
            (server) => Effect.promise(() => server.stop()).pipe(Effect.orDie),
          ),
      });

      const localUiRemoteEntry = (source: { name: string; localRoot: string }) =>
        Effect.gen(function* () {
          const server = yield* ScopedCache.get(servers, source.localRoot);
          const containerPath = path.join(
            source.localRoot,
            "dist",
            "ssr",
            UI_REMOTE_SERVER_ENTRY_FILENAME,
          );
          const containerVersion = existsSync(containerPath)
            ? String(statSync(containerPath).mtimeMs)
            : "pending";
          const slot: EntrySlot = {
            name: source.name,
            localPath: source.localRoot,
            ssrUrl: `${server.baseUrl}/ssr`,
            containerVersion,
          };
          return slot;
        });

      return FederationContainers.of({ localUiRemoteEntry });
    }),
  );
}

export function resolveLocalRoot(localPath: string): string {
  return path.resolve(process.cwd(), localPath);
}

export const waitForLocalContainer = Effect.fn("waitForLocalContainer")(function* (
  entry: EntrySlot,
  env: BosEnv,
): Effect.fn.Return<void, FederationError> {
  const containerUrl = entryUrls(entry, env).ssr;
  if (!containerUrl) {
    return yield* new FederationError({
      remoteName: entry.name,
      detail: `${entry.name} SSR container has no entry URL — no local dist server`,
    });
  }
  let announced = false;
  let polls = 0;
  const startedAt = yield* Clock.currentTimeMillis;
  const check = Effect.tryPromise({
    try: async (signal) => {
      polls++;
      const res = await runFetch(containerUrl, { signal });
      const body = await res.text();
      return res.ok && !/not found|<(!doctype|html)/i.test(body.slice(0, 64));
    },
    catch: () => false,
  }).pipe(
    Effect.orElseSucceed(() => false),
    Effect.tap((ready) =>
      !ready && !announced
        ? Effect.gen(function* () {
            announced = true;
            yield* Effect.log(`⏳ waiting for ${entry.name} to compile (SSR container not ready)…`);
          })
        : Effect.void,
    ),
  );
  const ready = yield* Effect.repeat(check, {
    schedule: Schedule.spaced(`${LOCAL_CONTAINER_READY_POLL_MS} millis`),
    until: (isReady) => isReady,
  }).pipe(
    Effect.timeoutOrElse({
      duration: `${LOCAL_CONTAINER_READY_TIMEOUT_MS} millis`,
      orElse: () => Effect.succeed(false),
    }),
  );
  if (!ready) {
    return yield* new FederationError({
      remoteName: entry.name,
      remoteUrl: containerUrl,
      detail: `${entry.name} SSR container never became ready at ${containerUrl}`,
    });
  }
  yield* Effect.logDebug("local container wait").pipe(
    Effect.annotateLogs({
      remote: entry.name,
      url: containerUrl,
      polls,
      durationMs: (yield* Clock.currentTimeMillis) - startedAt,
    }),
  );
});
