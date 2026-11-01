import { and, eq, sql } from "drizzle-orm";
import { Context, Data, Effect, Layer } from "effect";
import {
  isReservedSecretName,
  isValidSecretName,
  SECRET_NAME_PATTERN,
} from "everything-dev/hosting/secrets";
import { type Database, DatabaseTag } from "../db/layer";
import { runtimeSecrets } from "../db/schema";
import { createSealedBox } from "./sealed-box";

export class SecretsStoreError extends Data.TaggedError("SecretsStoreError")<{
  message: string;
  cause?: unknown;
}> {}

export interface SecretStatus {
  name: string;
  state: "set" | "missing" | "undeclared";
}

export { isReservedSecretName, isValidSecretName };

/**
 * Per-runtime KEK: the platform root secret (BETTER_AUTH_SECRET) HKDF'd
 * through createSealedBox with a runtime-scoped salt, so two runtimes' values
 * are sealed under different keys while sharing one root. The KEK source is a
 * swappable sub-seam (ticket 13): a custody-TEE swap changes the root's
 * origin without touching this schema, the CLI, or the config's
 * `secrets: []` declarations.
 */
const kekSalt = (account: string, gateway: string): string =>
  `everything-dev-runtime-secrets/${account}/${gateway}`;

const runtimeBox = (rootSecret: string, account: string, gateway: string) =>
  createSealedBox(kekSalt(account, gateway), rootSecret);

export interface SecretsStoreService {
  readonly set: (input: {
    account: string;
    gateway: string;
    name: string;
    value: string;
    setBy?: string;
  }) => Effect.Effect<{ name: string }, SecretsStoreError>;
  readonly list: (input: {
    account: string;
    gateway: string;
    declared?: string[] | undefined;
  }) => Effect.Effect<{ secrets: SecretStatus[]; missing: string[] }, SecretsStoreError>;
  readonly remove: (input: {
    account: string;
    gateway: string;
    name: string;
  }) => Effect.Effect<{ removed: boolean }, SecretsStoreError>;
  /**
   * Unsealed values for instance delivery — consumed by the reconciler when
   * assembling `identityEnv`. Values are never returned by the list route.
   */
  readonly resolve: (input: {
    account: string;
    gateway: string;
    names?: string[] | undefined;
  }) => Effect.Effect<Record<string, string>, SecretsStoreError>;
}

export class SecretsStore extends Context.Service<SecretsStore, SecretsStoreService>()(
  "api/SecretsStore",
) {}

/** Exported for the test harness (KEK-binding tests); production wiring is `SecretsStoreLive`. */
export function buildSecretsStore(db: Database, rootSecret: string): SecretsStoreService {
  const sealError = (name: string, cause: unknown) =>
    new SecretsStoreError({ message: `Failed to seal secret ${name}`, cause });

  const openError = (name: string, cause: unknown) =>
    new SecretsStoreError({
      message:
        `Secret ${name} could not be opened under this runtime's KEK — it was sealed ` +
        `under a different root secret (rotated, or a dev run's per-run secret). Re-set it.`,
      cause,
    });

  return {
    set: ({ account, gateway, name, value, setBy }) =>
      Effect.gen(function* () {
        if (!SECRET_NAME_PATTERN.test(name)) {
          return yield* new SecretsStoreError({
            message: `Invalid secret name ${name} — use UPPER_SNAKE_CASE env-var style`,
          });
        }
        if (isReservedSecretName(name)) {
          return yield* new SecretsStoreError({
            message: `Secret name ${name} is reserved (BOS_* and PORT are composed by the platform)`,
          });
        }
        const box = runtimeBox(rootSecret, account, gateway);
        const sealedValue = yield* Effect.tryPromise({
          try: () => box.seal(value),
          catch: (cause) => sealError(name, cause),
        });
        yield* Effect.tryPromise({
          try: () =>
            db
              .insert(runtimeSecrets)
              .values({ account, gateway, name, sealedValue, setBy: setBy ?? null })
              .onConflictDoUpdate({
                target: [runtimeSecrets.account, runtimeSecrets.gateway, runtimeSecrets.name],
                set: { sealedValue, setBy: setBy ?? null, updatedAt: sql`now()` },
              }),
          catch: (cause) => new SecretsStoreError({ message: `Failed to store ${name}`, cause }),
        });
        return { name };
      }),

    list: ({ account, gateway, declared }) =>
      Effect.gen(function* () {
        const rows = yield* Effect.tryPromise({
          try: () =>
            db
              .select({ name: runtimeSecrets.name })
              .from(runtimeSecrets)
              .where(and(eq(runtimeSecrets.account, account), eq(runtimeSecrets.gateway, gateway))),
          catch: (cause) => new SecretsStoreError({ message: "Failed to list secrets", cause }),
        });
        const stored = new Set(rows.map((row) => row.name));

        if (!declared) {
          return {
            secrets: rows.map((row) => ({ name: row.name, state: "set" as const })),
            missing: [],
          };
        }

        const declaredList = [...new Set(declared)];
        const secrets: SecretStatus[] = [
          ...declaredList.map(
            (name): SecretStatus => ({
              name,
              state: stored.has(name) ? "set" : "missing",
            }),
          ),
          ...rows
            .filter((row) => !declaredList.includes(row.name))
            .map((row): SecretStatus => ({ name: row.name, state: "undeclared" })),
        ];
        return {
          secrets,
          missing: declaredList.filter((name) => !stored.has(name)),
        };
      }),

    remove: ({ account, gateway, name }) =>
      Effect.gen(function* () {
        const deleted = yield* Effect.tryPromise({
          try: () =>
            db
              .delete(runtimeSecrets)
              .where(
                and(
                  eq(runtimeSecrets.account, account),
                  eq(runtimeSecrets.gateway, gateway),
                  eq(runtimeSecrets.name, name),
                ),
              )
              .returning({ name: runtimeSecrets.name }),
          catch: (cause) => new SecretsStoreError({ message: `Failed to remove ${name}`, cause }),
        });
        return { removed: deleted.length > 0 };
      }),

    resolve: ({ account, gateway, names }) =>
      Effect.gen(function* () {
        const rows = yield* Effect.tryPromise({
          try: () =>
            db
              .select({ name: runtimeSecrets.name, sealedValue: runtimeSecrets.sealedValue })
              .from(runtimeSecrets)
              .where(and(eq(runtimeSecrets.account, account), eq(runtimeSecrets.gateway, gateway))),
          catch: (cause) => new SecretsStoreError({ message: "Failed to resolve secrets", cause }),
        });
        const wanted = names ? new Set(names) : null;
        const box = runtimeBox(rootSecret, account, gateway);
        const out: Record<string, string> = {};
        for (const row of rows) {
          if (wanted && !wanted.has(row.name)) continue;
          out[row.name] = yield* Effect.tryPromise({
            try: () => box.open(row.sealedValue),
            catch: (cause) => openError(row.name, cause),
          });
        }
        return out;
      }),
  };
}

export const SecretsStoreLive = (rootSecret: string) =>
  Layer.effect(
    SecretsStore,
    Effect.gen(function* () {
      const db = yield* DatabaseTag;
      return buildSecretsStore(db, rootSecret);
    }),
  );
