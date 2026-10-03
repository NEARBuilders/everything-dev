import process from "node:process";
import { Context } from "effect";
import {
  type ConfigHistoryEntry,
  fetchBosConfigFromFastKv,
  fetchConfigHistory,
  fetchDeployManifests,
} from "../fastkv";
import {
  buildAndPushImage,
  deployImageToRailway,
  hasDocker,
  resolveImageRef,
} from "../image-deploy";
import { publishToFastKv } from "../publish";
import { openResolution } from "../resolution/session";
import { buildRollbackPayload, summarizeSlotPins, verifyRollbackSnapshot } from "../rollback";
import type { BosConfigInput } from "../types";
import { BosConfigSchema } from "../types";
import { colors, icons } from "../utils/theme";
import { type BosBuilder, BosDepsTag } from "./shared";

export function registerDeploy(builder: BosBuilder) {
  return {
    publish: builder.publish.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      const session = deps.session;
      if (!session?.config) {
        return {
          status: "error" as const,
          registryUrl: "",
          error: "No bos.config.json found",
        };
      }

      const result = await publishToFastKv({
        bosConfig: session.config,
        runtimeConfig: session.runtime,
        configDir: session.root,
        env: input.env,
        build: false,
        dryRun: input.dryRun,
        verbose: input.verbose,
        packages: "all",
        network: input.network,
        privateKey: input.privateKey,
        wallet: input.wallet,
        registry: input.registry,
      });

      return {
        status: result.status,
        registryUrl: result.registryUrl,
        txHash: result.txHash,
        error: result.error,
        built: result.built,
        skipped: result.skipped,
        deployResults: result.deployResults,
      };
    }),

    rollback: builder.rollback.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      const session = deps.session;
      if (!session) {
        return {
          status: "error" as const,
          registryUrl: "",
          error: "No bos.config.json found",
        };
      }

      const { account, domain } = session.config ?? {};
      if (!account || !domain) {
        return {
          status: "error" as const,
          registryUrl: "",
          error: "bos.config.json must define account and domain to roll back",
        };
      }

      let history: ConfigHistoryEntry[];
      try {
        history = await fetchConfigHistory({
          accountId: account,
          gatewayId: domain,
          registry: input.registry,
          limit: input.limit,
        });
      } catch (error) {
        return {
          status: "error" as const,
          registryUrl: "",
          error: `Failed to fetch publish history: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      if (history.length === 0) {
        return {
          status: "error" as const,
          registryUrl: "",
          error: `No publish history for ${account}/${domain} — nothing to roll back to`,
        };
      }

      const historyEntries = history.map((entry) => ({
        blockHeight: entry.blockHeight,
        blockTimestamp: new Date(Number(entry.blockTimestampNs.slice(0, 13))).toISOString(),
        ...(entry.txHash ? { txHash: entry.txHash } : {}),
        summary: summarizeSlotPins(entry.value as BosConfigInput),
      }));

      if (input.listOnly) {
        return {
          status: "list" as const,
          registryUrl: "",
          history: historyEntries,
        };
      }

      const target =
        input.version !== undefined
          ? history.find((entry) => {
              const iso = new Date(Number(entry.blockTimestampNs.slice(0, 13))).toISOString();
              return (
                String(entry.blockHeight) === input.version ||
                iso.startsWith(input.version as string)
              );
            })
          : input.previous
            ? history[1]
            : undefined;

      if (!target) {
        return {
          status: "error" as const,
          registryUrl: "",
          history: historyEntries,
          error: input.version
            ? `No history entry matches "${input.version}" — pick a block height from the listing`
            : "Specify --version <block-height> or --previous (interactive selection happens CLI-side)",
        };
      }

      let liveValue: unknown;
      try {
        liveValue = await fetchBosConfigFromFastKv<unknown>(
          `bos://${account}/${domain}`,
          input.registry,
        );
      } catch {
        liveValue = undefined;
      }
      if (liveValue && JSON.stringify(liveValue) === JSON.stringify(target.value)) {
        return {
          status: "error" as const,
          registryUrl: "",
          error: "The selected snapshot is identical to the live config — nothing to do",
        };
      }

      const verification = await verifyRollbackSnapshot(target.value as BosConfigInput);
      const slotChecks = verification.slots.map((check) => ({
        slot: check.slot,
        ok: check.ok,
        ...(check.reason ? { reason: check.reason } : {}),
      }));
      if (!verification.ok && verification.verifiable) {
        return {
          status: "error" as const,
          registryUrl: "",
          verification: slotChecks,
          error:
            "Refusing to roll back — a pinned slot's bytes are gone or no longer match their SRI",
        };
      }

      if (!verification.verifiable && !input.force) {
        return {
          status: "error" as const,
          registryUrl: "",
          error:
            "Snapshot predates version manifests and cannot be verified — its bytes were overwritten in place. Re-run with --force to publish it anyway.",
        };
      }

      const parsedTarget = BosConfigSchema.parse(target.value);
      const payload = buildRollbackPayload(parsedTarget, new Date().toISOString());

      const result = await publishToFastKv({
        bosConfig: payload,
        runtimeConfig: session.runtime,
        configDir: session.root,
        env: input.env,
        build: false,
        dryRun: input.dryRun,
        verbose: input.verbose,
        packages: "all",
        network: input.network,
        privateKey: input.privateKey,
        wallet: input.wallet,
        registry: input.registry,
      });

      return {
        status: result.status,
        registryUrl: result.registryUrl,
        txHash: result.txHash,
        error: result.error,
        history: historyEntries,
        ...(slotChecks.length > 0 ? { verification: slotChecks } : {}),
      };
    }),

    deploy: builder.deploy.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      const session = deps.session;
      if (!session?.config) {
        return {
          status: "error" as const,
          registryUrl: "",
          error: "No bos.config.json found",
        };
      }

      if (input.statusList) {
        if (!session.config?.account || !session.config.domain) {
          return {
            status: "error" as const,
            registryUrl: "",
            error: "bos.config.json must define account and domain to list deploy manifests",
          };
        }
        try {
          const manifests = await fetchDeployManifests({
            accountId: session.config.account,
            gatewayId: session.config.domain,
            registry: input.registry,
          });
          return {
            status: "list" as const,
            registryUrl: "",
            history: manifests.map((entry) => ({
              key: entry.key,
              blockHeight: entry.blockHeight,
              blockTimestamp: new Date(Number(entry.blockTimestampNs.slice(0, 13))).toISOString(),
              ...((entry.value as { txHash?: string } | undefined)?.txHash
                ? { txHash: (entry.value as { txHash?: string }).txHash }
                : {}),
              ...((entry.value as { publishedAt?: string } | undefined)?.publishedAt
                ? { publishedAt: (entry.value as { publishedAt?: string }).publishedAt }
                : {}),
            })),
          };
        } catch (error) {
          return {
            status: "error" as const,
            registryUrl: "",
            error: `Failed to list deploy manifests: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      const result = await publishToFastKv({
        bosConfig: session.config,
        runtimeConfig: session.runtime,
        configDir: session.root,
        env: input.env,
        build: input.build,
        dryRun: input.dryRun,
        verbose: input.verbose,
        packages: input.packages,
        network: input.network,
        privateKey: input.privateKey,
        registry: input.registry,
      });

      if (result.status === "error") {
        return {
          status: "error" as const,
          registryUrl: result.registryUrl,
          txHash: result.txHash,
          built: result.built,
          skipped: result.skipped,
          error: result.error,
          deployResults: result.deployResults,
        };
      }

      if (result.status === "dry-run") {
        return {
          status: "dry-run" as const,
          registryUrl: result.registryUrl,
          built: result.built,
          skipped: result.skipped,
        };
      }

      let nextSession = session;
      if (result.publishConfig) {
        const opened = await openResolution({ cwd: session.root });
        if (opened) {
          nextSession = opened;
        }
      }

      const configPublished = {
        registryUrl: result.registryUrl,
        txHash: result.txHash,
        fingerprint: result.fingerprint,
        slotPins: result.slotPins,
        built: result.built,
        skipped: result.skipped,
        deployResults: result.deployResults,
      } as const;

      let image: string | undefined;
      let imageDigest: string | undefined;
      let service: string | undefined;

      const imageRef = resolveImageRef({
        ciImage: nextSession.config?.ci?.image,
        repository: nextSession.config?.repository,
        env: process.env,
      });
      if (!imageRef) {
        console.log();
        console.log(
          colors.yellow(
            "  Image skipped: set ci.image in bos.config.json (or BOS_IMAGE) to build and push the runtime image",
          ),
        );
      } else if (!(await hasDocker())) {
        console.log();
        console.log(colors.yellow("  Image skipped: docker is not available"));
      } else {
        console.log();
        try {
          const imageResult = await buildAndPushImage({
            image: imageRef.image,
            configDir: session.root,
            verbose: input.verbose,
          });
          image = imageResult.image;
          imageDigest = imageResult.digest;
          console.log(
            colors.green(
              `  ${icons.ok} Image pushed ${imageResult.image}:${imageResult.tag}${imageResult.digest ? ` (${imageResult.digest.slice(0, 19)}…)` : ""}`,
            ),
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const imageError =
            message.includes("not found") || message.includes("ENOENT")
              ? "Docker not found — install Docker to build the runtime image"
              : `Image build/push failed: ${message}`;
          console.log(colors.yellow(`  ${imageError}`));
          return {
            status: "published" as const,
            ...configPublished,
            error: `Config published but ${imageError}`,
          };
        }
      }

      if (process.env.RAILWAY_TOKEN) {
        const railwayService = input.service ?? nextSession.config?.ci?.railway?.service;
        if (!railwayService) {
          console.log();
          console.log(
            colors.yellow(
              "  Railway deploy skipped: ci.railway.service is not configured in bos.config.json",
            ),
          );
          return {
            status: "published" as const,
            ...configPublished,
            image,
            error:
              "Config published but Railway deploy failed: ci.railway.service is not configured in bos.config.json",
          };
        }
        if (!image || !imageDigest) {
          console.log();
          console.log(
            colors.yellow(
              "  Railway deploy skipped: no pushed image digest — set ci.image and install docker",
            ),
          );
          return {
            status: "published" as const,
            ...configPublished,
            image,
            service: railwayService,
            error:
              "Config published but Railway deploy requires a pushed image (set ci.image and install docker)",
          };
        }

        service = railwayService;
        try {
          await deployImageToRailway({
            image,
            digest: imageDigest,
            service: railwayService,
            configDir: session.root,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const railError =
            message.includes("not found") || message.includes("ENOENT")
              ? "Railway CLI not found. Install it: npm i -g @railway/cli"
              : `Railway deploy failed: ${message}`;
          console.log(colors.yellow(`  ${railError}`));
          return {
            status: "published" as const,
            ...configPublished,
            image,
            service,
            error: `Config published but ${railError}`,
          };
        }
      } else {
        console.log();
        console.log(colors.yellow("  Railway deploy skipped (RAILWAY_TOKEN not set)"));
      }

      return {
        status: "deployed" as const,
        ...configPublished,
        image,
        service,
      };
    }),
  };
}
