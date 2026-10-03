import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { Context } from "effect";
import { readAuthoredConfigInput, resolveConfigComposableEntries } from "../config";
import type { BosConfigResult } from "../contract";
import { fetchBosConfigFromFastKv } from "../fastkv";
import { applyRegistrySections } from "../registry-use";
import { walkExtendsChain } from "../resolution/session";
import type { BosConfig, BosConfigInput } from "../types";
import { BosConfigSchema } from "../types";
import { type BosBuilder, BosDepsTag } from "./shared";

export function registerConfig(builder: BosBuilder) {
  return {
    config: builder.config.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      if (input.full) {
        return buildConfigResult(deps.session?.config ?? null, true);
      }

      const localConfig = await readAuthoredConfigInput(deps.session?.root);
      return buildConfigResult(localConfig, false);
    }),

    registryUse: builder.registryUse.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      const configPath = join(deps.session?.root ?? process.cwd(), "bos.config.json");
      const normalizedFrom = input.from.startsWith("bos://") ? input.from : `bos://${input.from}`;

      try {
        const remote = await fetchBosConfigFromFastKv<Record<string, unknown>>(normalizedFrom);
        const local = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
        const { config: merged, applied } = applyRegistrySections(
          local as never,
          remote as never,
          input.sections,
        );

        if (input.dryRun) {
          return {
            status: "dry-run" as const,
            from: normalizedFrom,
            applied,
            configPath,
          };
        }

        writeFileSync(configPath, `${JSON.stringify(merged, null, 2)}\n`);

        return {
          status: "updated" as const,
          from: normalizedFrom,
          applied,
          configPath,
        };
      } catch (error) {
        return {
          status: "error" as const,
          from: normalizedFrom,
          applied: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  };
}

function buildConfigResult(
  bosConfig: BosConfigInput | BosConfig | null,
  full = false,
): BosConfigResult {
  const packages =
    bosConfig?.app && typeof bosConfig.app === "object" ? Object.keys(bosConfig.app) : [];
  const remotes = packages.filter((name) => name !== "host");

  return {
    config: bosConfig ?? null,
    packages,
    remotes,
    full,
  };
}

export async function resolveRemoteConfigChain(
  accountId: string,
  gatewayId: string,
  registry?: string,
): Promise<BosConfig> {
  const { config: merged } = await walkExtendsChain(`bos://${accountId}/${gatewayId}`, {
    env: "production",
    registry,
    visit: async () => {},
  });

  return resolveConfigComposableEntries(BosConfigSchema.parse(merged), process.cwd(), "production");
}
