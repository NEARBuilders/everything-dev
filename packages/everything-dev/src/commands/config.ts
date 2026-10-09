import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { Context } from "effect";
import {
  loadAppDescriptorConfig,
  localConfigEntryPath,
  readAuthoredConfigInput,
  readLocalAuthoredConfigInput,
  resolveConfigComposableEntries,
} from "../config";
import type { BosConfigResult } from "../contract";
import { fetchBosConfigFromFastKv } from "../fastkv";
import { applyRegistrySections } from "../registry-use";
import { walkExtendsChain } from "../resolution/session";
import type { BosConfig, BosConfigInput } from "../types";
import { BosConfigSchema } from "../types";
import { saveBosConfig } from "../utils/save-config";
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
      const root = deps.session?.root ?? process.cwd();
      const configPath = localConfigEntryPath(root) ?? join(root, "bos.config.json");
      const normalizedFrom = input.from.startsWith("bos://") ? input.from : `bos://${input.from}`;

      try {
        const remote = await fetchBosConfigFromFastKv<Record<string, unknown>>(normalizedFrom);
        const localRaw = await readLocalAuthoredConfigInput(root);
        const local = (localRaw ??
          (configPath.endsWith(".json")
            ? (JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>)
            : ((await loadAppDescriptorConfig(configPath)) as unknown as Record<
                string,
                unknown
              >))) as Record<string, unknown>;
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

        await saveBosConfig(root, merged);

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
