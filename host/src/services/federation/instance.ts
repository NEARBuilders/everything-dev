import { createInstance } from "@module-federation/enhanced/runtime";
import { Context, Effect, Layer, Semaphore } from "effect";
import { FederationError } from "../errors";

export type ModuleFederationInstance = ReturnType<typeof createInstance>;

/** One generation of the shared composition instance: the MF instance plus
 * the generation id its loads are cached under. A compose pins one session —
 * every module it loads executes inside this instance's share scope. */
export interface CompositionSession {
  readonly mf: ModuleFederationInstance;
  readonly generation: number;
}

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
 * The shared Module Federation composition instance, swapped by generation.
 *
 * Invariants (epic #473, tickets #470/#478):
 *
 * 1. ONE instance per generation ⇒ ONE share scope per generation — core
 *    Router and plugin trees negotiate singletons (react, react-dom,
 *    @tanstack/*) in the same scope; separate instances mint separate React
 *    copies and a composed SSR tree that mixes them crashes with "Invalid
 *    hook call".
 * 2. Registering a remote NEVER seen before joins the live instance in
 *    place — its container initializes on first load inside the shared
 *    scope; already-loaded modules are untouched.
 * 3. An ENTRY CHANGE for an already-registered remote retires the whole
 *    generation: the runtime reuses an initialized container for the remote
 *    name no matter what the registration says, so the only honest swap is a
 *    fresh instance carrying the full desired entry set. In-flight composes
 *    keep the session they pinned (resolved modules stay valid); the next
 *    compose opens on the new generation — shadow-flip, no drain.
 * 4. A compose pins ONE session and every load inside it executes through
 *    that session's instance — a deploy landing mid-compose cannot mix two
 *    generations into one tree; the mixed tree would only surface as a
 *    render-time crash after the 200 already started.
 * 5. Share-scope init is serialized (the runtime's `initializeSharing` is
 *    not documented as concurrency-safe) and must resolve before any expose
 *    load — each load surfaces its own error.
 * 6. The live instance and every retired generation die with the service's
 *    scope — the finalizer removes all remotes; no global disposal.
 */
export class CompositionRuntime extends Context.Service<
  CompositionRuntime,
  {
    /** Atomically reconcile the desired remote entry set and return the
     * session to load through: first call creates the instance; unseen
     * remotes join in place; any changed entry retires the generation and
     * returns a fresh instance with the full set. Synchronous — the returned
     * session is the generation its loads must cache under. */
    readonly ensureRemotes: (remotes: { name: string; entry: string }[]) => CompositionSession;
    readonly bypassModuleCache: (session: CompositionSession, remoteName: string) => void;
    readonly initializeShareScope: (
      mf: ModuleFederationInstance,
    ) => Effect.Effect<void, FederationError>;
  }
>()("host/services/federation/CompositionRuntime") {
  static readonly layer = Layer.effect(
    CompositionRuntime,
    Effect.gen(function* () {
      let instance: ModuleFederationInstance | null = null;
      let generation = 0;
      const registeredEntries = new Map<string, string>();
      const retired: ModuleFederationInstance[] = [];
      const shareScopePermits = Semaphore.makeUnsafe(1);

      const createGeneration = (entries: Map<string, string>) => {
        if (instance) retired.push(instance);
        instance = createInstance({
          name: "host-ssr-compose",
          remotes: [...entries.entries()].map(([name, entry]) => ({
            name,
            entry,
            alias: name,
          })),
        });
        generation++;
        registeredEntries.clear();
        for (const [name, entry] of entries) registeredEntries.set(name, entry);
        return instance;
      };

      const ensureRemotes = (
        remotes: { name: string; entry: string }[],
      ): CompositionSession => {
        if (!instance) {
          createGeneration(new Map(remotes.map((remote) => [remote.name, remote.entry])));
          return { mf: instance!, generation };
        }
        let changed = false;
        for (const { name, entry } of remotes) {
          const registered = registeredEntries.get(name);
          if (registered === entry) continue;
          if (registered === undefined) {
            instance.registerRemotes([{ name, entry, alias: name }]);
            registeredEntries.set(name, entry);
            continue;
          }
          changed = true;
        }
        if (changed) {
          const desired = new Map(registeredEntries);
          for (const { name, entry } of remotes) desired.set(name, entry);
          createGeneration(desired);
        }
        return { mf: instance!, generation };
      };

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          const all = instance ? [...retired, instance] : [...retired];
          for (const dead of all) removeInstanceRemotes(dead);
          instance = null;
          retired.length = 0;
          registeredEntries.clear();
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
        ensureRemotes,
        bypassModuleCache: (session, remoteName) =>
          bypassInstanceModuleCache(session.mf, remoteName),
        initializeShareScope,
      });
    }),
  );
}
