import process from "node:process";
import * as p from "@clack/prompts";
import { Effect } from "effect";
import type { ResultRenderer } from "../cli/commands/context";
import type { SecretsListResult, SecretsRemoveResult, SecretsSetResult } from "../contract";
import { SessionStore } from "../services/auth/session-store";
import { parseSiteErrorDetail, SiteClient } from "../services/auth/site-client";
import { isReservedSecretName, isValidSecretName } from "../services/hosting/secrets";
import { ResolutionSessionService } from "../services/resolution/session";
import { colors, icons } from "../utils/theme";
import type { BosBuilder } from "./shared";

/**
 * Resolve the runtime identity + declared secrets from the resolution
 * session's config (the authored bos.app.ts in the cwd). The rows the vault
 * stores are keyed by this identity; the vault ITSELF is whichever deployment
 * answers at the credential's site.
 */
function collectDeclaredSecrets(config: unknown): string[] {
  const cfg = config as {
    secrets?: string[];
    app?: Record<string, { secrets?: string[] } | undefined>;
    plugins?: Record<string, { secrets?: string[] } | undefined> | undefined;
  } | null;
  if (!cfg) return [];
  const declared = new Set<string>();
  for (const secret of cfg.secrets ?? []) declared.add(secret);
  for (const section of Object.values(cfg.app ?? {})) {
    for (const secret of section?.secrets ?? []) declared.add(secret);
  }
  for (const plugin of Object.values(cfg.plugins ?? {})) {
    for (const secret of plugin?.secrets ?? []) declared.add(secret);
  }
  return [...declared];
}

/**
 * v1 tier heuristic (plan 055 ticket 09): authoritative tier data arrives with
 * the tenant bindings surface (ticket 14). Until then, a target that is
 * neither the declared config's own runtime nor a child of the vault site's
 * runtime gets an honest warning — a BYO-account runtime supplies its own env,
 * so rows stored for it would never be delivered.
 */
function hostingRelationshipWarning(
  config: unknown,
  siteUrl: string,
  account: string,
  gateway: string,
): string | null {
  const cfg = config as { account?: string; domain?: string; extends?: unknown } | null | undefined;
  if (cfg?.account === account && cfg?.domain === gateway) return null;
  const extendsText = JSON.stringify(cfg?.extends ?? "");
  const siteHost = new URL(siteUrl).host;
  if (extendsText.includes(siteHost) || extendsText.includes(new URL(siteUrl).hostname)) {
    return null;
  }
  return (
    `The target runtime (${account}/${gateway}) is not this config's declared runtime, and its ` +
    `extends chain does not reference the vault site (${siteHost}). If this is a BYO-account ` +
    `runtime, it supplies its own env — these rows will not be delivered to it.`
  );
}

export function registerSecrets(builder: BosBuilder) {
  return {
    secretsSet: builder.secretsSet.effect(function* (_opts, input) {
      const session = yield* ResolutionSessionService;
      const sessions = yield* SessionStore;
      const siteClient = yield* SiteClient;

      const configDir = session?.root ?? process.cwd();
      const credential = sessions.read(configDir)?.credential;
      if (!credential?.apiKey) {
        return { status: "error" as const, error: "No CLI credential — run `bos login` first" };
      }
      const siteUrl = input.site ?? credential.siteUrl;
      if (!siteUrl) {
        return {
          status: "error" as const,
          error: "No vault site — pass --site or re-run `bos login`",
        };
      }

      if (!isValidSecretName(input.name)) {
        return {
          status: "error" as const,
          error: isReservedSecretName(input.name)
            ? `Secret name ${input.name} is reserved (BOS_* and PORT are composed by the platform)`
            : "Secret name must be UPPER_SNAKE_CASE env-var style",
        };
      }

      const value =
        input.value ??
        (yield* Effect.promise(() =>
          p.password({ message: `Value for ${input.name} (input hidden)` }),
        ));
      if (p.isCancel(value)) process.exit(0);
      if (!value) {
        return { status: "error" as const, error: "Empty secret value — nothing stored" };
      }

      const account = session?.config?.account;
      const gateway = session?.config?.domain;
      if (!account || !gateway) {
        return {
          status: "error" as const,
          error: "No declared runtime identity — the authored config's account/domain are required",
        };
      }

      const response = yield* Effect.promise(() =>
        siteClient.rpcPost(
          siteUrl,
          "/api/rpc/secrets/set",
          { account, gateway, name: input.name, value },
          undefined,
          { "x-api-key": credential.apiKey },
        ),
      );
      if (response.status !== 200) {
        const detail = parseSiteErrorDetail(response.status, response.json);
        return { status: "error" as const, error: detail ?? `Vault refused (${response.status})` };
      }
      return {
        status: "set" as const,
        name: input.name,
        siteUrl,
        warning:
          hostingRelationshipWarning(session?.config, siteUrl, account, gateway) ?? undefined,
      } satisfies SecretsSetResult;
    }),

    secretsList: builder.secretsList.effect(function* (_opts, input) {
      const session = yield* ResolutionSessionService;
      const sessions = yield* SessionStore;
      const siteClient = yield* SiteClient;

      const configDir = session?.root ?? process.cwd();
      const credential = sessions.read(configDir)?.credential;
      if (!credential?.apiKey) {
        return { status: "error" as const, error: "No CLI credential — run `bos login` first" };
      }
      const siteUrl = input.site ?? credential.siteUrl;
      if (!siteUrl) {
        return {
          status: "error" as const,
          error: "No vault site — pass --site or re-run `bos login`",
        };
      }

      const account = input.account ?? session?.config?.account;
      const gateway = input.gateway ?? session?.config?.domain;
      if (!account || !gateway) {
        return {
          status: "error" as const,
          error: "No target runtime — pass --account/--gateway or run from the runtime's repo",
        };
      }

      const response = yield* Effect.promise(() =>
        siteClient.rpcPost(
          siteUrl,
          "/api/rpc/secrets/list",
          { account, gateway, declared: collectDeclaredSecrets(session?.config) },
          undefined,
          { "x-api-key": credential.apiKey },
        ),
      );
      if (response.status !== 200) {
        const detail = parseSiteErrorDetail(response.status, response.json);
        return { status: "error" as const, error: detail ?? `Vault refused (${response.status})` };
      }
      const body = (
        response.json as { json?: { secrets?: SecretsListResult["secrets"]; missing?: string[] } }
      ).json;
      return {
        status: "listed" as const,
        secrets: body?.secrets ?? [],
        missing: body?.missing ?? [],
        siteUrl,
        warning:
          hostingRelationshipWarning(session?.config, siteUrl, account, gateway) ?? undefined,
      } satisfies SecretsListResult;
    }),

    secretsRemove: builder.secretsRemove.effect(function* (_opts, input) {
      const session = yield* ResolutionSessionService;
      const sessions = yield* SessionStore;
      const siteClient = yield* SiteClient;

      const configDir = session?.root ?? process.cwd();
      const credential = sessions.read(configDir)?.credential;
      if (!credential?.apiKey) {
        return { status: "error" as const, error: "No CLI credential — run `bos login` first" };
      }
      const siteUrl = credential.siteUrl;
      if (!siteUrl) {
        return { status: "error" as const, error: "No vault site — re-run `bos login`" };
      }

      if (!input.yes) {
        const confirmed = yield* Effect.promise(() =>
          p.confirm({ message: `Remove ${input.name} from the vault at ${siteUrl}?` }),
        );
        if (p.isCancel(confirmed)) process.exit(0);
        if (!confirmed) {
          return {
            status: "error" as const,
            name: input.name,
            error: "Cancelled — nothing removed",
          };
        }
      }

      const account = session?.config?.account;
      const gateway = session?.config?.domain;
      if (!account || !gateway) {
        return {
          status: "error" as const,
          error: "No declared runtime identity — the authored config's account/domain are required",
        };
      }

      const response = yield* Effect.promise(() =>
        siteClient.rpcPost(
          siteUrl,
          "/api/rpc/secrets/remove",
          { account, gateway, name: input.name },
          undefined,
          { "x-api-key": credential.apiKey },
        ),
      );
      if (response.status !== 200) {
        const detail = parseSiteErrorDetail(response.status, response.json);
        return { status: "error" as const, error: detail ?? `Vault refused (${response.status})` };
      }
      const body = (response.json as { json?: { removed?: boolean } }).json;
      return body?.removed
        ? ({ status: "removed" as const, name: input.name } satisfies SecretsRemoveResult)
        : ({ status: "not-found" as const, name: input.name } satisfies SecretsRemoveResult);
    }),
  };
}

export const secretsRenderers: Record<string, ResultRenderer> = {
  secretsSet: async (result: SecretsSetResult) => {
    console.log();
    if (result.status === "set") {
      console.log(`  ${colors.green(`${icons.ok} Secret ${result.name} stored`)}`);
      console.log(`  ${colors.dim(`Vault: ${result.siteUrl}`)}`);
      console.log(`  ${colors.dim("The value is sealed at rest and never echoed back")}`);
      if (result.warning) console.log(`  ${colors.yellow("⚠")} ${result.warning}`);
    } else {
      console.log(`  ${colors.error(`${icons.err} ${result.error ?? "Failed to store secret"}`)}`);
    }
    console.log();
  },

  secretsList: async (result: SecretsListResult) => {
    console.log();
    if (result.status !== "listed") {
      console.log(`  ${colors.error(`${icons.err} ${result.error ?? "Failed to list secrets"}`)}`);
      console.log();
      return;
    }
    console.log(
      `  ${colors.green(`${icons.ok} Secrets`)} ${colors.dim(`vault: ${result.siteUrl}`)}`,
    );
    if (result.warning) console.log(`  ${colors.yellow("⚠")} ${result.warning}`);
    const rows = result.secrets ?? [];
    if (rows.length === 0) {
      console.log(`  ${colors.dim("No secrets stored and nothing declared")}`);
    }
    for (const secret of rows) {
      const mark =
        secret.state === "set"
          ? colors.green("set")
          : secret.state === "missing"
            ? colors.yellow("missing")
            : colors.dim("undeclared");
      console.log(`  ${colors.dim(secret.name.padEnd(24))} ${mark}`);
    }
    if ((result.missing ?? []).length > 0) {
      console.log();
      console.log(
        `  ${colors.yellow("⚠")} Missing: ${result.missing!.join(", ")} — set them with \`bos secrets set NAME\``,
      );
    }
    console.log();
  },

  secretsRemove: async (result: SecretsRemoveResult) => {
    console.log();
    if (result.status === "removed") {
      console.log(`  ${colors.green(`${icons.ok} Removed ${result.name}`)}`);
    } else if (result.status === "not-found") {
      console.log(`  ${colors.yellow("⚠")} ${result.name} was not stored`);
    } else {
      console.log(`  ${colors.error(`${icons.err} ${result.error ?? "Failed to remove"}`)}`);
    }
    console.log();
  },
};
