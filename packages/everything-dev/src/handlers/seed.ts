import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseDotenv } from "dotenv";
import { Effect } from "effect";
import { MISSING_CONFIG_MESSAGE } from "../config";
import { ResolutionSessionService } from "../services/resolution/session";
import {
  resolveSeedWorkspaces,
  runSeedPhase,
  type SeedOwnerCredential,
} from "../services/seed/runner";
import type { BosBuilder } from "./shared";

const PRODUCTION_OWNER_ENV_KEYS = {
  nearAccount: "SEED_OWNER_ADMIN_NEAR_ACCOUNT",
  email: "SEED_OWNER_ADMIN_EMAIL",
} as const;

/**
 * Production owner credentials come from the environment only — never the
 * authored config (#865). The authored `seed.auth.ownerAdmin` block is a dev
 * convenience; in production its presence DEMANDS the env credentials rather
 * than defaulting to it.
 */
function productionOwnerCredentials(
  env: Record<string, string | undefined>,
): SeedOwnerCredential | null {
  const nearAccount = env[PRODUCTION_OWNER_ENV_KEYS.nearAccount];
  const email = env[PRODUCTION_OWNER_ENV_KEYS.email];
  const credential: SeedOwnerCredential = {};
  if (nearAccount) credential.nearAccount = nearAccount;
  if (email) credential.email = email;
  return credential.nearAccount || credential.email ? credential : null;
}

/** `.env` merged over the ambient process env — the seed phase's database URLs. */
function loadProjectEnv(configDir: string): Record<string, string | undefined> {
  const envPath = join(configDir, ".env");
  if (!existsSync(envPath)) return { ...process.env };
  try {
    return { ...process.env, ...parseDotenv(readFileSync(envPath, "utf8")) };
  } catch {
    return { ...process.env };
  }
}

export function registerSeed(builder: BosBuilder) {
  return {
    seed: builder.seed.effect(function* (_opts, input) {
      const session = yield* ResolutionSessionService;
      if (!session?.config) {
        return { status: "skipped" as const, env: input.env, error: MISSING_CONFIG_MESSAGE };
      }
      const seed = session.config.seed;
      if (!seed) {
        return {
          status: "skipped" as const,
          env: input.env,
          error: "No seed block declared in the authored config (bos.app.ts / bos.dev.ts)",
        };
      }
      const configDir = input.configDir ?? session.root ?? process.cwd();

      const runtime = yield* Effect.tryPromise({
        try: async () => session.buildRuntime(),
        catch: (error) => ({
          status: "error" as const,
          env: input.env,
          error: `building the runtime config failed: ${error instanceof Error ? error.message : String(error)}`,
        }),
      });

      const env = loadProjectEnv(configDir);

      let ownerOverride: SeedOwnerCredential | undefined;
      if (input.env === "production") {
        const nonPostgres = resolveSeedWorkspaces(runtime, configDir, env)
          .filter((ws) => !ws.url.startsWith("postgres://") && !ws.url.startsWith("postgis://"))
          .map((ws) => `${ws.key} (${ws.url.split(":")[0]}:...)`);
        if (nonPostgres.length > 0) {
          return {
            status: "error" as const,
            env: input.env,
            error:
              `production seeding refuses non-postgres database URLs: ${nonPostgres.join(", ")} — ` +
              "point the workspace *_DATABASE_URL secrets at postgres:// URLs in .env",
          };
        }
        if (seed.auth?.ownerAdmin) {
          const credential = productionOwnerCredentials(env);
          if (!credential) {
            return {
              status: "error" as const,
              env: input.env,
              error:
                "seed.auth.ownerAdmin is declared — production requires explicit owner credentials in the environment: " +
                `set ${PRODUCTION_OWNER_ENV_KEYS.nearAccount} and/or ${PRODUCTION_OWNER_ENV_KEYS.email}`,
            };
          }
          ownerOverride = credential;
        }
      }

      const authVariables = runtime.auth?.variables as
        | { siwn?: { recipient?: string; recipients?: Record<string, string> } }
        | undefined;

      return yield* Effect.tryPromise({
        try: async () => {
          const result = await runSeedPhase({
            configDir,
            seed,
            runtime,
            fallbackAccount: session.config?.account,
            siwnRecipient:
              authVariables?.siwn?.recipients?.[runtime.networkId] ??
              authVariables?.siwn?.recipient,
            env,
            ownerOverride,
            force: input.force,
          });
          return {
            status: result.status,
            env: input.env,
            version: result.version,
            workspaces: result.workspaces,
            owner: result.owner,
            steps: result.steps,
          };
        },
        catch: (error) => ({
          status: "error" as const,
          env: input.env,
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    }),
  };
}
