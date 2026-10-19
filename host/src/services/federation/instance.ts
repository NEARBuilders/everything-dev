import { createInstance } from "@module-federation/enhanced/runtime";
import { Context, Effect, Layer, Semaphore } from "effect";
import { FederationError } from "../errors";

export type ModuleFederationInstance = ReturnType<typeof createInstance>;

/**
 * Unregister a remote (or every remote when the name is omitted) through the
 * runtime's remote handler. `registerRemotes` replaces the entry even when
 * removal fails; the worst case is a shallow pin in the runtime's global
 * instance list, which is append-only inside @module-federation.
 */
function removeInstanceRemotes(instance: ModuleFederationInstance, remoteName?: string): void {
  try {
    const handler = (
      instance as unknown as {
        remoteHandler?: { removeRemote?: (remote: unknown) => void };
      }
    ).remoteHandler;
    const targets = instance.options.remotes.filter(
      (remote) => remoteName === undefined || remote.name === remoteName,
    );
    for (const remote of targets) {
      handler?.removeRemote?.(remote);
    }
  } catch {
    /* noop */
  }
}

/**
 * Drop the runtime's cached container module for one remote — the dev
 * hot-reload / integrity-bump bypass. Best effort: keyed by remote name on
 * private MF internals; a failure only leaves a stale module reused in dev.
 */
function bypassInstanceModuleCache(mf: ModuleFederationInstance, remoteName: string): void {
  try {
    (mf as unknown as { moduleCache?: Map<string, unknown> }).moduleCache?.delete(remoteName);
  } catch {
    /* noop */
  }
}

/**
 * The shared Module Federation composition instance and its swap bookkeeping.
 *
 * Invariants (epic #473, ticket #470):
 *
 * 1. ONE instance for all SSR loads ⇒ ONE share scope — core Router and
 *    plugin trees negotiate singletons (react, react-dom, @tanstack/*) in
 *    the same scope; separate instances mint separate React copies and
 *    composed SSR crashes with "Invalid hook call".
 * 2. An entry-URL change (integrity bump, hot reload) re-registers the
 *    remote in place — same share scope, fresh remote entry.
 * 3. `bypassModuleCache` evicts the runtime's cached container module so an
 *    uncached caller (local dev hot reload) re-executes the expose.
 * 4. Share-scope init is serialized (the runtime's `initializeSharing` is
 *    not documented as concurrency-safe) and must resolve before any expose
 *    load — each load surfaces its own error.
 * 5. The instance and every registered remote die with the service's scope —
 *    the finalizer removes all remotes; no global disposal.
 */
export class CompositionRuntime extends Context.Service<
  CompositionRuntime,
  {
    /** Create the instance on first call; re-register the remote in place when
     * its entry URL changed. Returns the shared instance. */
    readonly ensureRemote: (remote: { name: string; entry: string }) => ModuleFederationInstance;
    readonly removeRemote: (remoteName?: string) => void;
    readonly bypassModuleCache: (remoteName: string) => void;
    /** Whether this remote was previously loaded from a different entry URL —
     * the bypass trigger for mixed-version prevention. Pair with `markLoaded`. */
    readonly entryChanged: (remote: { name: string; entry: string }) => boolean;
    /** Record the entry URL a load started from — feeds `entryChanged`. */
    readonly markLoaded: (remote: { name: string; entry: string }) => void;
    readonly initializeShareScope: (
      mf: ModuleFederationInstance,
    ) => Effect.Effect<void, FederationError>;
  }
>()("host/services/federation/CompositionRuntime") {
  static readonly layer = Layer.effect(
    CompositionRuntime,
    Effect.gen(function* () {
      let instance: ModuleFederationInstance | null = null;
      const registeredEntries = new Map<string, string>();
      const loadedEntryByRemote = new Map<string, string>();
      const shareScopePermits = Semaphore.makeUnsafe(1);

      const ensureRemote = (remote: { name: string; entry: string }) => {
        if (!instance) {
          instance = createInstance({
            name: "host-ssr-compose",
            remotes: [{ name: remote.name, entry: remote.entry, alias: remote.name }],
          });
          registeredEntries.clear();
          registeredEntries.set(remote.name, remote.entry);
          return instance;
        }
        const registeredEntry = registeredEntries.get(remote.name);
        if (registeredEntry === remote.entry) {
          return instance;
        }
        if (registeredEntry !== undefined) {
          removeInstanceRemotes(instance, remote.name);
        }
        instance.registerRemotes([{ name: remote.name, entry: remote.entry, alias: remote.name }]);
        registeredEntries.set(remote.name, remote.entry);
        return instance;
      };

      const entryChanged = (remote: { name: string; entry: string }) => {
        const previous = loadedEntryByRemote.get(remote.name);
        return previous !== undefined && previous !== remote.entry;
      };

      const markLoaded = (remote: { name: string; entry: string }) => {
        loadedEntryByRemote.set(remote.name, remote.entry);
      };

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (instance) {
            removeInstanceRemotes(instance);
          }
          instance = null;
          registeredEntries.clear();
          loadedEntryByRemote.clear();
        }),
      );

      const initializeShareScope = (
        mf: ModuleFederationInstance,
      ): Effect.Effect<void, FederationError> =>
        shareScopePermits.withPermits(1)(
          Effect.tryPromise(() => {
            const sharing = (
              mf as unknown as { initializeSharing?: (scope: string) => unknown }
            ).initializeSharing?.("default");
            if (sharing instanceof Promise) {
              return sharing.then(() => undefined);
            }
            if (Array.isArray(sharing)) {
              return Promise.all(sharing).then(() => undefined);
            }
            return Promise.resolve();
          }).pipe(
            Effect.mapError((cause) => new FederationError({ remoteName: "share scope", cause })),
          ),
        );

      return CompositionRuntime.of({
        ensureRemote,
        entryChanged,
        markLoaded,
        removeRemote: (remoteName) => {
          if (instance) removeInstanceRemotes(instance, remoteName);
        },
        bypassModuleCache: (remoteName) => {
          if (instance) bypassInstanceModuleCache(instance, remoteName);
        },
        initializeShareScope,
      });
    }),
  );
}
