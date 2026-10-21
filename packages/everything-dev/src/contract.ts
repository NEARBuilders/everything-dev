import "@orpc/openapi/extensions/route";
import * as z from "zod";
import { oc } from "./sdk";
import { isValidImageDigest } from "./services/deploy/image";
import type { DevSessionData, StartSummary } from "./services/dev/session";
import {
  BosConfigInputSchema,
  BosConfigSchema,
  SourceModeSchema,
  StarterLevelSchema,
} from "./types";

export const PhaseTimingSchema = z.object({
  name: z.string(),
  durationMs: z.number(),
});

export const DevOptionsSchema = z.object({
  host: SourceModeSchema.default("local"),
  ui: SourceModeSchema.default("local"),
  api: SourceModeSchema.default("local"),
  auth: SourceModeSchema.default("local"),
  remotePlugins: z
    .array(z.string())
    .optional()
    .describe("Comma-separated plugin IDs to force remote (e.g. --remote-plugins auth,registry)"),

  proxy: z.boolean().default(false),
  ssr: z.boolean().default(false),
  port: z.number().optional(),
  apiPort: z.number().optional(),
  uiPort: z.number().optional(),
  authPort: z.number().optional(),
  pluginPortStart: z.number().optional(),
  interactive: z.boolean().optional(),
  logLevel: z
    .enum(["error", "warn", "info", "debug"])
    .optional()
    .describe(
      "Log tail level: error, warn (default), info, or debug (overrides BOS_LOG_LEVEL; the file always gets everything)",
    ),
});

export const DevResultSchema = z.object({
  status: z.enum(["started", "error"]),
  description: z.string(),
  processes: z.array(z.string()),
  timings: z.array(PhaseTimingSchema).optional(),
  session: z.custom<DevSessionData>().optional(),
});

export const StartOptionsSchema = z.object({
  port: z.number().optional(),
  interactive: z.boolean().optional(),
  account: z.string().optional().describe("New project NEAR account (auto-derived from extends)"),

  domain: z.string().optional(),
  env: z
    .enum(["production", "staging"])
    .default("production")
    .describe("Environment: production or staging"),

  registry: z
    .string()
    .optional()
    .describe(
      "Override FastKV registry contract account (defaults: dev.everything.near / dev.allthethings.testnet)",
    ),

  configPath: z
    .string()
    .optional()
    .describe(
      "Boot from a local bos config file — skips FastKV resolution and SRI integrity verification",
    ),
});

export const StartResultSchema = z.object({
  status: z.enum(["running", "error"]),
  url: z.string(),
  error: z.string().optional(),
  session: z.custom<DevSessionData>().optional(),
  summary: z.custom<StartSummary>().optional(),
});

export const BuildOptionsSchema = z.object({
  packages: z
    .string()
    .default("all")
    .describe(
      "Comma-separated keys, 'all' (default), or 'local' (only this repo's local plugins hosted via 'local:…')",
    ),
  force: z
    .boolean()
    .default(false)
    .describe(
      "Allow pre-Phase-A snapshots without verifiable manifest pins (their bytes were overwritten in place)",
    ),
});

export const BuildResultSchema = z.object({
  status: z.enum(["success", "error"]),
  error: z.string().optional(),
  built: z.array(z.string()),
  skipped: z.array(z.string()).optional(),
});

export const ConfigOptionsSchema = z.object({
  full: z.boolean().default(false).describe("Print the fully resolved configuration"),
});

export const ConfigResultSchema = z.object({
  config: z.union([BosConfigInputSchema, BosConfigSchema]).nullable(),
  packages: z.array(z.string()),
  remotes: z.array(z.string()),
  full: z.boolean().default(false),
});

export const RegistryUseOptionsSchema = z.object({
  from: z.string().describe("Published runtime to compose from (account/gateway or bos:// URL)"),
  sections: z
    .array(z.string())
    .min(1)
    .describe("Sections to compose: app.ui, app.host, app.api, app.auth, plugins.<key>"),
  dryRun: z.boolean().default(false).describe("Preview the merged config without writing"),
});

export const RegistryUseResultSchema = z.object({
  status: z.enum(["updated", "dry-run", "error"]),
  from: z.string(),
  applied: z.array(z.string()),
  configPath: z.string().optional(),
  error: z.string().optional(),
});

export const PluginAddOptionsSchema = z.object({
  source: z.string().describe("Plugin source (local:path, bos://account/domain, or URL)"),
  as: z.string().optional().describe("Plugin alias"),

  production: z.string().optional().describe("Production URL override"),
});

export const PluginAddResultSchema = z.object({
  status: z.enum(["added", "error"]),
  key: z.string(),
  development: z.string().optional(),
  production: z.string().optional(),
  integrity: z.string().optional(),
  version: z
    .string()
    .optional()
    .describe("Block height (or timestamp) of the snapshot from the listing"),

  error: z.string().optional(),
});

export const PluginRemoveOptionsSchema = z.object({
  key: z.string(),
});

export const PluginRemoveResultSchema = z.object({
  status: z.enum(["removed", "error"]),
  key: z.string(),
  error: z.string().optional(),
});

export const PluginListResultSchema = z.object({
  status: z.enum(["listed", "error"]),
  plugins: z.array(
    z.object({
      key: z.string(),
      development: z.string().optional(),
      production: z.string().optional(),
      localPath: z.string().optional(),
      source: z.enum(["local", "remote"]),
      integrity: z.string().optional(),
      version: z.string().optional(),
      name: z.string().optional(),
    }),
  ),
  error: z.string().optional(),
});

export const PluginPublishOptionsSchema = z.object({
  key: z.string(),
});

export const PluginPublishResultSchema = z.object({
  status: z.enum(["published", "error"]),
  key: z.string(),
  path: z.string().optional(),
  production: z.string().optional(),
  version: z
    .string()
    .optional()
    .describe("Block height (or timestamp) of the snapshot from the listing"),

  fingerprint: z.string().optional(),
  error: z.string().optional(),
});

export const WorkspaceDeployResultSchema = z.object({
  key: z.string(),
  kind: z.enum(["app", "plugin"]),
  success: z.boolean(),
  error: z.string().optional(),
  durationMs: z.number().optional(),
  /** Build warnings captured from the workspace's own build output —
   * attributed here, never streamed as raw interleaved stderr. */
  warnings: z.array(z.string()).default([]),
});

export const PublishOptionsSchema = z.object({
  dryRun: z.boolean().default(false).describe("Preview what would be published without writing"),

  verbose: z.boolean().default(false).describe("Show full build output instead of clean summary"),

  network: z.enum(["mainnet", "testnet"]).optional().describe("NEAR network: mainnet or testnet"),

  privateKey: z.string().optional(),
  wallet: z
    .boolean()
    .default(false)
    .describe(
      "Publish gaslessly with a one-time wallet approval (NEP-366 delegate action relayed by the platform relayer)",
    ),

  env: z
    .enum(["production", "staging"])
    .default("production")
    .describe("Environment: production or staging"),

  registry: z
    .string()
    .optional()
    .describe(
      "Override FastKV registry contract account (defaults: dev.everything.near / dev.allthethings.testnet)",
    ),
});

export const RollbackOptionsSchema = z.object({
  listOnly: z.boolean().default(false),
  version: z.string().optional(),
  previous: z
    .boolean()
    .default(false)
    .describe("Roll back to the write immediately before the current one"),

  force: z
    .boolean()
    .default(false)
    .describe(
      "Allow pre-Phase-A snapshots without verifiable manifest pins (their bytes were overwritten in place)",
    ),

  limit: z.number().int().min(1).max(200).default(20).describe("Listing depth (1-200, default 20)"),

  dryRun: z.boolean().default(false).describe("Preview the rollback without publishing"),

  verbose: z.boolean().default(false).describe("Show full build output instead of clean summary"),

  network: z.enum(["mainnet", "testnet"]).optional().describe("NEAR network: mainnet or testnet"),

  privateKey: z.string().optional(),
  wallet: z
    .boolean()
    .default(false)
    .describe(
      "Publish gaslessly with a one-time wallet approval (NEP-366 delegate action relayed by the platform relayer)",
    ),

  env: z
    .enum(["production", "staging"])
    .default("production")
    .describe("Environment: production or staging"),

  registry: z
    .string()
    .optional()
    .describe(
      "Override FastKV registry contract account (defaults: dev.everything.near / dev.allthethings.testnet)",
    ),
});

export const RollbackHistoryEntrySchema = z.object({
  blockHeight: z.number(),
  blockTimestamp: z.string(),
  txHash: z.string().optional(),
  summary: z.string(),
});

export const RollbackSlotCheckSchema = z.object({
  slot: z.string(),
  ok: z.boolean(),
  reason: z.string().optional(),
});

export const RollbackResultSchema = z.object({
  status: z.enum(["published", "error", "dry-run", "list"]),
  registryUrl: z.string(),
  txHash: z.string().optional(),
  error: z.string().optional(),
  history: z.array(RollbackHistoryEntrySchema).optional(),
  verification: z.array(RollbackSlotCheckSchema).optional(),
});

export const PublishResultSchema = z.object({
  status: z.enum(["published", "error", "dry-run"]),
  registryUrl: z.string(),
  txHash: z.string().optional(),
  fingerprint: z.string().optional(),
  slotPins: z.record(z.string(), z.string()).optional(),
  error: z.string().optional(),
  built: z.array(z.string()).optional(),
  skipped: z.array(z.string()).optional(),
  deployResults: z.array(WorkspaceDeployResultSchema).optional(),
});

export const DeployOptionsSchema = z.object({
  statusList: z.boolean().default(false),
  env: z
    .enum(["production", "staging"])
    .default("production")
    .describe("Environment: production or staging"),

  build: z
    .boolean()
    .default(true)
    .describe("Build and deploy workspaces before publish (default: true)"),

  dryRun: z.boolean().default(false).describe("Preview what would be deployed without writing"),

  verbose: z.boolean().default(false),
  packages: z
    .string()
    .default("all")
    .describe(
      "Comma-separated keys, 'all' (default), or 'local' (only this repo's local plugins hosted via 'local:…')",
    ),
  network: z.enum(["mainnet", "testnet"]).optional().describe("NEAR network: mainnet or testnet"),

  privateKey: z.string().optional(),
  service: z.string().optional().describe("Override Railway service name from config"),

  registry: z
    .string()
    .optional()
    .describe(
      "Override FastKV registry contract account (defaults: dev.everything.near / dev.allthethings.testnet)",
    ),

  imageDigest: z
    .string()
    .optional()
    .refine((digest) => digest === undefined || isValidImageDigest(digest), {
      message: "image digest must be sha256:<64 hex characters>",
    })
    .describe(
      "Digest (sha256:…) of a pre-pushed runtime image — skips the image build/push leg and pins Railway to this digest",
    ),
  fullUpload: z
    .boolean()
    .default(false)
    .describe(
      "Re-upload every dist file instead of diffing unchanged files against the previous deploy",
    ),
  forceBuild: z
    .boolean()
    .default(false)
    .describe(
      "Force every prerequisite workspace rebuild even when the content-hash staleness oracle judges them fresh",
    ),
  smoke: z
    .boolean()
    .default(false)
    .describe(
      "After publish, boot the runtime image against the just-published config and gate the Railway promotion on it — a red smoke rolls the config back to the previous snapshot",
    ),
});

export const DeployManifestListEntrySchema = z.object({
  key: z.string(),
  blockHeight: z.number(),
  blockTimestamp: z.string(),
  txHash: z.string().optional(),
  publishedAt: z.string().optional(),
});

export const DeployLegOutcomeSchema = z.object({
  status: z.enum(["ok", "skipped", "failed"]),
  detail: z.string().optional(),
});

export const DeployResultSchema = z.object({
  status: z.enum(["deployed", "published", "error", "dry-run", "list"]),
  registryUrl: z.string(),
  txHash: z.string().optional(),
  fingerprint: z.string().optional(),
  slotPins: z.record(z.string(), z.string()).optional(),
  history: z.array(DeployManifestListEntrySchema).optional(),
  built: z.array(z.string()).optional(),
  skipped: z.array(z.string()).optional(),
  image: z.string().optional(),
  service: z.string().optional(),
  legs: z
    .object({
      image: DeployLegOutcomeSchema.optional(),
      smoke: DeployLegOutcomeSchema.optional(),
      railway: DeployLegOutcomeSchema.optional(),
    })
    .optional(),
  error: z.string().optional(),
  deployResults: z.array(WorkspaceDeployResultSchema).optional(),
});

export const SmokeOptionsSchema = z.object({
  image: z
    .string()
    .optional()
    .describe("Runtime image ref to boot — required unless defaulted by the deploy train"),
  port: z
    .number()
    .int()
    .default(3000)
    .describe("Host port to publish the container on (default: 3000)"),

  keep: z.boolean().default(false).describe("Keep the container after the run (debugging)"),

  account: z
    .string()
    .optional()
    .describe("Registry identity — defaults to the resolved session config"),
  gateway: z.string().optional(),
  apiDatabaseUrl: z.string().optional(),
  authDatabaseUrl: z.string().optional(),
  env: z
    .enum(["production", "staging"])
    .default("production")
    .describe("Environment: production or staging"),

  registry: z
    .string()
    .optional()
    .describe(
      "Override FastKV registry contract account (defaults: dev.everything.near / dev.allthethings.testnet)",
    ),
});

export const SmokeResultSchema = z.object({
  status: z.enum(["ok", "error"]),
  image: z.string().optional(),
  summary: z.string().optional(),
  diagnosis: z.string().optional(),
  error: z.string().optional(),
});

function parseNearAmount(value: string): number {
  const cleaned = value.replace(/[\s_,]/g, "");
  const match = cleaned.match(/^(\d+(?:\.\d+)?)near$/i);
  if (!match) return NaN;
  return Number.parseFloat(match[1]!);
}

const MIN_PUBLISH_ALLOWANCE_NEAR = 0.3;

export const KeyPublishOptionsSchema = z.object({
  allowance: z
    .string()
    .default("1NEAR")
    .refine(
      (val) => {
        const amount = parseNearAmount(val);
        return !Number.isNaN(amount) && amount >= MIN_PUBLISH_ALLOWANCE_NEAR;
      },
      {
        message: `Allowance must be at least ${MIN_PUBLISH_ALLOWANCE_NEAR} NEAR to cover the transaction cost`,
      },
    )
    .describe("NEAR allowance for the key (default: 1NEAR, min: 0.3NEAR)"),

  env: z
    .enum(["production", "staging"])
    .default("production")
    .describe("Environment: production (default) or staging"),

  registry: z.string().optional(),
  removeOldKeys: z
    .boolean()
    .optional()
    .describe(
      "Remove existing publish key(s) without prompting (default: ask on a TTY, defaulting to keep; keep when non-interactive — pass --remove-old-keys to remove)",
    ),
});

export const KeyPublishResultSchema = z.object({
  status: z.enum(["published", "error"]),
  account: z.string(),
  network: z.enum(["mainnet", "testnet"]),
  env: z.enum(["production", "staging"]),
  contract: z.string(),
  allowance: z.string(),
  functionNames: z.array(z.string()),
  publicKey: z.string().optional(),
  privateKey: z.string().optional(),
  error: z.string().optional(),
});

export const OverrideSectionSchema = z.enum(["ui", "api", "host", "plugins"]);

export const DEFAULT_LOGIN_EXPIRES_IN_SECONDS = 90 * 24 * 60 * 60;
export const DEFAULT_DEPLOY_KEY_EXPIRES_IN_SECONDS = 365 * 24 * 60 * 60;

export const LoginOptionsSchema = z.object({
  key: z
    .boolean()
    .default(false)
    .describe(
      "Mint a scoped deploy key (bundles:write for the config's account/gateway), store it as the session credential, and print it for BOS_STORAGE_API_KEY — plus export the publish key for headless/CI use",
    ),

  custody: z
    .boolean()
    .default(false)
    .describe("Also register an OutLayer custody wallet for custody publishes"),

  site: z.string().optional().describe("Override site URL hosting the CLI login page"),

  expiresIn: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Credential lifetime in seconds (default: 90 days; deploy keys with --key: 365 days)",
    ),

  device: z
    .string()
    .optional()
    .describe("Device label recorded on the credential (default: hostname)"),

  env: z.enum(["production", "staging"]).default("production"),
  registry: z.string().optional(),
});

export const LoginResultSchema = z.object({
  status: z.enum(["logged-in", "error"]),
  siteUrl: z.string(),
  accountId: z.string().nullish(),
  expiresAt: z.string().nullish(),
  loginUrl: z.string().nullish(),
  publishKey: z
    .object({
      publicKey: z.string(),
      network: z.enum(["mainnet", "testnet"]),
      contract: z.string(),
      exportedTo: z.string(),
    })
    .nullish(),
  deployKey: z
    .object({
      key: z.string(),
      account: z.string(),
      gateway: z.string(),
    })
    .nullish(),
  custodyWallet: z
    .object({
      walletId: z.string(),
      nearAccountId: z.string(),
      network: z.enum(["mainnet", "testnet"]),
      handoffUrl: z.string().nullish(),
    })
    .nullish(),
  outlayerCli: z
    .object({
      status: z.enum(["linked", "cli-missing", "error"]),
      network: z.enum(["mainnet", "testnet"]),
      detail: z.string().nullish(),
    })
    .nullish(),
  warning: z.string().nullish(),
  error: z.string().optional(),
});

export const LogoutOptionsSchema = z.object({
  configDir: z.string().optional().describe("Override config directory"),
});

export const LogoutResultSchema = z.object({
  status: z.enum(["logged-out", "error"]),
  revokedApiKey: z.boolean(),
  removedPublishKey: z.boolean(),
  warning: z.string().nullish(),
  error: z.string().optional(),
});

export const RuntimeOverrideTargetBaseSchema = z.enum(["ui", "api", "plugins"]);

export const RuntimeOverrideTargetSchema = z.union([
  RuntimeOverrideTargetBaseSchema,
  z.string().regex(/^plugins\.(\*|[a-z0-9_-]+)$/),
]);

export const InitOptionsSchema = z.object({
  extends: z
    .string()
    .optional()
    .describe("Parent to extend from (e.g. bos://account/gateway or account/gateway)"),
  directory: z.string().optional().describe("Target directory (auto-derived from domain)"),

  account: z.string().optional().describe("New project NEAR account (auto-derived from extends)"),

  domain: z.string().optional().describe("New project domain (e.g. myapp.everything.dev)"),
  source: z.string().optional().describe("Local source dir (skips GitHub download)"),

  plugins: z
    .array(z.string())
    .optional()
    .describe("Comma-separated plugin keys to include (requires --overrides=plugins)"),
  overrides: z
    .array(OverrideSectionSchema)
    .optional()
    .describe("Comma-separated sections to customize locally: ui,api,host,plugins"),
  level: StarterLevelSchema.optional().describe(
    "Starter complexity: simple (public shell) or advanced (adds dashboard, orgs, admin)",
  ),

  noInteractive: z.boolean().default(false).describe("Skip prompts, use flags only"),

  noInstall: z.boolean().default(false).describe("Skip pnpm install"),
});

export const InitResultSchema = z.object({
  status: z.enum(["initialized", "error"]),
  directory: z.string(),
  extendsRef: z.string(),
  account: z.string().optional(),
  domain: z.string().optional(),
  extends: z.string(),
  plugins: z.array(z.string()).optional(),
  overrides: z.array(OverrideSectionSchema).optional(),
  filesCopied: z.number(),
  timings: z.array(PhaseTimingSchema).optional(),
  targetDir: z.string().optional(),
  error: z.string().optional(),
});

export const SyncOptionsSchema = z.object({
  dryRun: z.boolean().default(false).describe("Preview changes without writing files"),

  noInstall: z.boolean().default(false).describe("Skip pnpm install"),

  json: z.boolean().default(false),
});

export const SyncResultSchema = z.object({
  status: z.enum(["synced", "dry-run", "error"]),
  updated: z.array(z.string()),
  skipped: z.array(z.string()),
  added: z.array(z.string()),
  conflicted: z.array(z.string()).default([]),
  /** retired stub files deleted silently (unmodified) — ADR 0023 migration */
  retired: z.array(z.string()).optional(),
  /** retired stub files that were hand-modified — backed up, then deleted */
  retiredConflicted: z.array(z.string()).optional(),
  /** where the retired hand-modified copies were backed up */
  retiredBackupDir: z.string().optional(),
  backupDir: z.string().optional(),
  error: z.string().optional(),
});

export const ImportOptionsSchema = z.object({
  workspace: z.string().describe("Workspace subtree path (e.g. plugins/auth)"),
  /** omitted → resolve the upstream from the authored config's extends chain */
  from: z
    .string()
    .optional()
    .describe(
      "Upstream source: bos://<account>/<gateway>, <owner>/<repo>[@<ref>], GitHub URL, or local directory — defaults to the authored config's extends chain",
    ),

  yes: z
    .boolean()
    .default(false)
    .describe("Apply upstream over conflicting files without prompting"),

  dryRun: z
    .boolean()
    .default(false)
    .describe("Preview classification and report without writing files"),

  noInstall: z.boolean().default(false).describe("Skip pnpm install"),

  json: z.boolean().default(false),
});

export const ImportRouteDeltaSchema = z.object({
  oursOnly: z.array(z.string()),
  theirsOnly: z.array(z.string()),
});

export const ImportMigrationCollisionSchema = z.object({
  kind: z.literal("tag-mismatch"),
  idx: z.number(),
  localTag: z.string().optional(),
  upstreamTag: z.string().optional(),
  message: z.string(),
});

export const ImportMigrationAppendSchema = z.object({
  idx: z.number(),
  fromTag: z.string(),
  toTag: z.string(),
});

export const ImportMigrationReconciliationSchema = z.object({
  /** local journal tags kept verbatim (already applied, never renumbered) */
  kept: z.array(z.string()),
  /** upstream migrations renumbered and appended after the local tail */
  appended: z.array(ImportMigrationAppendSchema),
  /** upstream migrations matched to local entries by SQL content hash */
  contentMatched: z.array(z.string()),
});

export const ImportResultSchema = z.object({
  status: z.enum(["imported", "dry-run", "conflicts", "error"]),
  workspace: z.string(),
  from: z.string(),
  ref: z.string(),
  resolvedSha: z.string().optional(),
  /** the dereferenced upstream repository when the source was chain-resolved */
  sourceRepository: z.string().optional(),
  /** resolution notes (e.g. HEAD fallback when no git sha is pinned) */
  warnings: z.array(z.string()).default([]),
  added: z.array(z.string()),
  updated: z.array(z.string()),
  unchanged: z.array(z.string()).default([]),
  preservedLocal: z.array(z.string()).default([]),
  merged: z.array(z.string()).default([]),
  conflicts: z.array(z.string()).default([]),
  heldBackMigrations: z.array(z.string()).default([]),
  routeDelta: ImportRouteDeltaSchema.optional(),
  migrationCollisions: z.array(ImportMigrationCollisionSchema).default([]),
  migrationReconciliation: ImportMigrationReconciliationSchema.optional(),
  backupDir: z.string().optional(),
  reportPath: z.string().optional(),
  error: z.string().optional(),
});

export const UpgradeOptionsSchema = z.object({
  dryRun: z.boolean().default(false).describe("Preview changes without writing"),

  check: z.boolean().default(false).describe("CI check — exit 1 when updates are available"),

  noInstall: z.boolean().default(false).describe("Skip pnpm install"),

  noSync: z.boolean().default(false).describe("Only upgrade packages, skip template sync"),

  json: z.boolean().default(false),
  migrationsOnly: z.boolean().default(false),
});

export const UpgradeResultSchema = z.object({
  status: z.enum(["upgraded", "dry-run", "error"]),
  packages: z.array(
    z.object({
      name: z.string(),
      from: z.string().optional(),
      to: z.string(),
    }),
  ),
  sync: SyncResultSchema.optional(),
  migrated: z.array(z.string()).optional(),
  availablePlugins: z.array(z.string()).optional(),
  selectedPlugins: z.array(z.string()).optional(),
  /** The resolved platform release manifest when one publishes (ADR 0034). */
  platform: z
    .object({
      resolved: z.string(),
      source: z.string(),
      fromCache: z.boolean(),
    })
    .optional(),
  /** Dry-run/check only: whether any update is available. */
  updatesAvailable: z.boolean().optional(),
  timings: z.array(PhaseTimingSchema).optional(),
  changelogUrl: z.string().optional(),
  error: z.string().optional(),
});

export const DeployedVersionStatusSchema = z.object({
  publishedFingerprint: z.string(),
  servedFingerprint: z.string().optional(),
  inSync: z.boolean(),
  error: z.string().optional(),
});

export const StatusResultSchema = z.object({
  status: z.enum(["ok", "error"]),
  deployedVersion: DeployedVersionStatusSchema.optional(),
  extends: z.string().optional(),
  account: z.string().optional(),
  domain: z.string().optional(),
  packages: z.array(
    z.object({
      name: z.string(),
      installed: z.string().optional(),
      latest: z.string().optional(),
      isLinked: z.boolean().optional(),
      specifier: z.string().optional(),
    }),
  ),
  lastSync: z.string().optional(),
  envFile: z.enum(["found", "missing", "example-only"]),
  parentReachable: z.boolean().optional(),
  error: z.string().optional(),
});

export const TypesGenOptionsSchema = z.object({
  env: z
    .enum(["development", "production"])
    .optional()
    .describe("Environment: development (default) or production"),
  dryRun: z
    .boolean()
    .default(false)
    .describe("Preview what would be fetched without writing files"),
  remotePlugins: z
    .array(z.string())
    .optional()
    .describe(
      "Comma-separated plugin IDs to fetch contract types remotely (e.g. --remote-plugins auth,registry)",
    ),
});

export const TypesGenResultSchema = z.object({
  status: z.enum(["success", "error"]),
  generated: z.array(z.string()),
  fetched: z.array(z.string()),
  skipped: z.array(z.string()),
  failed: z.array(z.string()),
  error: z.string().optional(),
});

export const DbStudioOptionsSchema = z.object({
  plugin: z
    .string()
    .default("api")
    .describe("Plugin key: api, auth, or a plugin name (default: api)"),
});

export const DbStudioResultSchema = z.object({
  status: z.enum(["success", "error"]),
  plugin: z.string(),
  source: z.enum(["local", "remote"]),
  section: z.string(),
  databaseSecret: z.string().optional(),
  databaseUrl: z.string().optional(),
  workspaceDir: z.string().optional(),
  error: z.string().optional(),
});

export const DbDoctorOptionsSchema = z.object({
  plugin: z.string().describe("Plugin key: api, auth, or a plugin name"),
});

export const DbDoctorResultSchema = z.object({
  status: z.enum(["success", "error"]),
  plugin: z.string(),
  slug: z.string(),
  journalTable: z.string(),
  journalSchema: z.string(),
  diagnosis: z.string(),
  localMigrationCount: z.number(),
  appliedHashCount: z.number(),
  expectedTables: z.array(z.string()),
  missingTables: z.array(z.string()),
  workspaceDir: z.string().optional(),
  dbSecret: z.string().optional(),
  dbUrl: z.string().optional(),
  error: z.string().optional(),
});

export const DbRepairOptionsSchema = z.object({
  plugin: z.string().describe("Plugin key: api, auth, or a plugin name"),
  mode: z
    .enum(["history-reset", "recreate"])
    .default("history-reset")
    .describe("Repair mode: history-reset (default) or recreate (not yet supported)"),
  yes: z.boolean().optional().describe("Skip confirmation prompt"),
});

export const DbRepairResultSchema = z.object({
  status: z.enum(["repaired", "refused", "error"]),
  message: z.string(),
  diagnosis: z.any(),
  error: z.string().optional(),
});

export const ProcessRoleSchema = z.enum(["standalone", "workspace-parent", "workspace-child"]);

export const PidEntrySchema = z.object({
  pid: z.number(),
  configDir: z.string(),
  parentPid: z.number().optional(),
  role: ProcessRoleSchema,
  ports: z
    .object({
      host: z.number().optional(),
      api: z.number().optional(),
      ui: z.number().optional(),
      auth: z.number().optional(),
    })
    .default({}),
  budget: z
    .object({
      min: z.number(),
      max: z.number(),
    })
    .optional(),
  startedAt: z.number(),
  description: z.string(),
});

export const PsResultSchema = z.object({
  status: z.enum(["ok", "error"]),
  entries: z.array(PidEntrySchema),
  error: z.string().optional(),
});

export const LogsOptionsSchema = z.object({
  service: z
    .string()
    .optional()
    .describe("Filter by service name (e.g. host, api, auth, ui, plugin:votes)"),
  tail: z.number().int().positive().max(100_000).optional().describe("Show only the last N lines"),

  follow: z.boolean().optional().describe("Stream the log as lines are appended"),
});

export const LogsResultSchema = z.object({
  logFile: z.string(),
  lines: z.array(z.string()),
});

export const KillOptionsSchema = z.object({
  configDir: z
    .string()
    .optional()
    .describe("Kill processes owned by a config directory (defaults to cwd)"),

  signal: z
    .enum(["SIGTERM", "SIGKILL"])
    .default("SIGTERM")
    .describe("Signal: SIGTERM (default) or SIGKILL"),

  all: z.boolean().default(false).describe("Kill processes across all config directories"),
});

export const KillResultSchema = z.object({
  status: z.enum(["killed", "error"]),
  killed: z.array(z.object({ pid: z.number(), configDir: z.string() })),
  skipped: z.array(z.object({ pid: z.number(), reason: z.string() })),
  error: z.string().optional(),
});

export const TypecheckOptionsSchema = z.object({
  packages: z.string().default("all").describe("Comma-separated workspace list (default: all)"),
});

export const TypecheckWorkspaceResultSchema = z.object({
  workspace: z.string(),
  passed: z.boolean(),
  output: z.string().optional(),
  error: z.string().optional(),
});

export const TypecheckResultSchema = z.object({
  status: z.enum(["success", "error"]),
  checked: z.array(z.string()),
  skipped: z.array(z.string()),
  results: z.array(TypecheckWorkspaceResultSchema),
  error: z.string().optional(),
});

export const InfraExportServiceSchema = z.object({
  key: z.string(),
  image: z.string(),
  env: z.record(z.string(), z.string()).default({}),
  ports: z.array(z.string()),
  healthcheck: z
    .object({
      test: z.array(z.string()),
      interval: z.string(),
      timeout: z.string(),
      retries: z.number(),
    })
    .optional(),
  volumes: z.array(z.string()).default([]),
});

export const InfraExportOptionsSchema = z.object({
  target: z.enum(["ci", "local"]).default("ci").describe("Export target: ci (default) or local"),

  network: z.enum(["mainnet", "testnet"]).optional(),
  configDir: z.string().optional().describe("Override config directory"),
});

export const InfraExportResultSchema = z.object({
  env: z.record(z.string(), z.string()),
  services: z.array(InfraExportServiceSchema),
  generatedAt: z.string(),
  project: z.string(),
  account: z.string(),
  gateway: z.string(),
});

export const MfCheckOptionsSchema = z.object({
  timeoutMs: z.number().default(15_000),
});

export const PlatformCompatViolationSchema = z.object({
  kind: z.enum(["minChild", "shared-dep"]),
  name: z.string().optional(),
  message: z.string(),
});

export const MfCheckRemoteResultSchema = z.object({
  role: z.string(),
  url: z.string(),
  reachable: z.boolean(),
  pluginVersion: z.string().nullable(),
  ok: z.boolean(),
  reason: z.string().optional(),
});

export const MfCheckResultSchema = z.object({
  status: z.enum(["ok", "fail"]),
  hostVersion: z.string().nullable(),
  hostReachable: z.boolean(),
  hostReason: z.string().optional(),
  remotes: z.array(MfCheckRemoteResultSchema),
  /** The platform compat gate (ADR 0034 pt 5) — present when a release manifest resolves. */
  platform: z
    .object({
      ok: z.boolean(),
      violations: z.array(PlatformCompatViolationSchema),
    })
    .optional(),
});

export const PlatformManifestOptionsSchema = z.object({
  check: z
    .boolean()
    .default(false)
    .describe("Also run the platform compat check against the local workspace"),
});

export const PlatformManifestResultSchema = z.object({
  status: z.enum(["ok", "absent", "fail"]),
  version: z.string().nullable(),
  source: z.string().optional(),
  fromCache: z.boolean().optional(),
  error: z.string().optional(),
  compat: z
    .object({
      ok: z.boolean(),
      violations: z.array(PlatformCompatViolationSchema),
    })
    .optional(),
});

export const commandOptionSchemas = {
  dev: DevOptionsSchema,
  start: StartOptionsSchema,
  build: BuildOptionsSchema,
  config: ConfigOptionsSchema,
  registryUse: RegistryUseOptionsSchema,
  pluginAdd: PluginAddOptionsSchema,
  pluginRemove: PluginRemoveOptionsSchema,
  pluginPublish: PluginPublishOptionsSchema,
  publish: PublishOptionsSchema,
  rollback: RollbackOptionsSchema,
  deploy: DeployOptionsSchema,
  smoke: SmokeOptionsSchema,
  keyPublish: KeyPublishOptionsSchema,
  login: LoginOptionsSchema,
  logout: LogoutOptionsSchema,
  init: InitOptionsSchema,
  sync: SyncOptionsSchema,
  import: ImportOptionsSchema,
  upgrade: UpgradeOptionsSchema,
  typecheck: TypecheckOptionsSchema,
  mfCheck: MfCheckOptionsSchema,
  platformManifest: PlatformManifestOptionsSchema,
  infraExport: InfraExportOptionsSchema,
  dbStudio: DbStudioOptionsSchema,
  dbDoctor: DbDoctorOptionsSchema,
  dbRepair: DbRepairOptionsSchema,
  logs: LogsOptionsSchema,
  kill: KillOptionsSchema,
} satisfies Partial<Record<keyof typeof bosContract, z.ZodType>>;

export const bosContract = oc.router({
  dev: oc.route({ method: "POST", path: "/dev" }).input(DevOptionsSchema).output(DevResultSchema),
  start: oc
    .route({ method: "POST", path: "/start" })
    .input(StartOptionsSchema)
    .output(StartResultSchema),
  build: oc
    .route({ method: "POST", path: "/build" })
    .input(BuildOptionsSchema)
    .output(BuildResultSchema),
  config: oc
    .route({ method: "GET", path: "/config" })
    .input(ConfigOptionsSchema)
    .output(ConfigResultSchema),
  registryUse: oc
    .route({ method: "POST", path: "/registry/use" })
    .input(RegistryUseOptionsSchema)
    .output(RegistryUseResultSchema),
  pluginAdd: oc
    .route({ method: "POST", path: "/plugin/add" })
    .input(PluginAddOptionsSchema)
    .output(PluginAddResultSchema),
  pluginRemove: oc
    .route({ method: "POST", path: "/plugin/remove" })
    .input(PluginRemoveOptionsSchema)
    .output(PluginRemoveResultSchema),
  pluginList: oc.route({ method: "GET", path: "/plugin/list" }).output(PluginListResultSchema),
  pluginPublish: oc
    .route({ method: "POST", path: "/plugin/publish" })
    .input(PluginPublishOptionsSchema)
    .output(PluginPublishResultSchema),
  publish: oc
    .route({ method: "POST", path: "/publish" })
    .input(PublishOptionsSchema)
    .output(PublishResultSchema),
  rollback: oc
    .route({ method: "POST", path: "/rollback" })
    .input(RollbackOptionsSchema)
    .output(RollbackResultSchema),
  deploy: oc
    .route({ method: "POST", path: "/deploy" })
    .input(DeployOptionsSchema)
    .output(DeployResultSchema),
  smoke: oc
    .route({ method: "POST", path: "/smoke" })
    .input(SmokeOptionsSchema)
    .output(SmokeResultSchema),
  keyPublish: oc
    .route({ method: "POST", path: "/key/publish" })
    .input(KeyPublishOptionsSchema)
    .output(KeyPublishResultSchema),
  login: oc
    .route({ method: "POST", path: "/login" })
    .input(LoginOptionsSchema)
    .output(LoginResultSchema),
  logout: oc
    .route({ method: "POST", path: "/logout" })
    .input(LogoutOptionsSchema)
    .output(LogoutResultSchema),
  init: oc
    .route({ method: "POST", path: "/init" })
    .input(InitOptionsSchema)
    .output(InitResultSchema),
  sync: oc
    .route({ method: "POST", path: "/sync" })
    .input(SyncOptionsSchema)
    .output(SyncResultSchema),
  import: oc
    .route({ method: "POST", path: "/import" })
    .input(ImportOptionsSchema)
    .output(ImportResultSchema),
  upgrade: oc
    .route({ method: "POST", path: "/upgrade" })
    .input(UpgradeOptionsSchema)
    .output(UpgradeResultSchema),
  status: oc.route({ method: "GET", path: "/status" }).output(StatusResultSchema),
  typesGen: oc
    .route({ method: "POST", path: "/types/gen" })
    .input(TypesGenOptionsSchema)
    .output(TypesGenResultSchema),
  dbStudio: oc
    .route({ method: "POST", path: "/db/studio" })
    .input(DbStudioOptionsSchema)
    .output(DbStudioResultSchema),
  dbDoctor: oc
    .route({ method: "POST", path: "/db/doctor" })
    .input(DbDoctorOptionsSchema)
    .output(DbDoctorResultSchema),
  dbRepair: oc
    .route({ method: "POST", path: "/db/repair" })
    .input(DbRepairOptionsSchema)
    .output(DbRepairResultSchema),
  ps: oc.route({ method: "GET", path: "/ps" }).output(PsResultSchema),
  logs: oc
    .route({ method: "GET", path: "/logs" })
    .input(LogsOptionsSchema)
    .output(LogsResultSchema),
  kill: oc
    .route({ method: "POST", path: "/kill" })
    .input(KillOptionsSchema)
    .output(KillResultSchema),
  typecheck: oc
    .route({ method: "POST", path: "/typecheck" })
    .input(TypecheckOptionsSchema)
    .output(TypecheckResultSchema),
  mfCheck: oc
    .route({ method: "POST", path: "/mf/check" })
    .input(MfCheckOptionsSchema)
    .output(MfCheckResultSchema),
  platformManifest: oc
    .route({ method: "POST", path: "/platform/manifest" })
    .input(PlatformManifestOptionsSchema)
    .output(PlatformManifestResultSchema),
  infraExport: oc
    .route({ method: "POST", path: "/infra/export" })
    .input(InfraExportOptionsSchema)
    .output(InfraExportResultSchema),
});

export type DevOptions = z.infer<typeof DevOptionsSchema>;
export type DevResult = z.infer<typeof DevResultSchema>;
export type StartOptions = z.infer<typeof StartOptionsSchema>;
export type StartResult = z.infer<typeof StartResultSchema>;
export type BuildOptions = z.infer<typeof BuildOptionsSchema>;
export type BosConfigResult = z.infer<typeof ConfigResultSchema>;
export type PluginAddOptions = z.infer<typeof PluginAddOptionsSchema>;
export type PluginAddResult = z.infer<typeof PluginAddResultSchema>;
export type PluginRemoveOptions = z.infer<typeof PluginRemoveOptionsSchema>;
export type PluginRemoveResult = z.infer<typeof PluginRemoveResultSchema>;
export type PluginListResult = z.infer<typeof PluginListResultSchema>;
export type PluginPublishOptions = z.infer<typeof PluginPublishOptionsSchema>;
export type PluginPublishResult = z.infer<typeof PluginPublishResultSchema>;
export type WorkspaceDeployResult = z.infer<typeof WorkspaceDeployResultSchema>;
export type PublishOptions = z.infer<typeof PublishOptionsSchema>;
export type PublishResult = z.infer<typeof PublishResultSchema>;
export type RollbackResult = z.infer<typeof RollbackResultSchema>;
export type DeployOptions = z.infer<typeof DeployOptionsSchema>;
export type DeployResult = z.infer<typeof DeployResultSchema>;
export type DeployLegOutcome = z.infer<typeof DeployLegOutcomeSchema>;
export type KeyPublishOptions = z.infer<typeof KeyPublishOptionsSchema>;
export type KeyPublishResult = z.infer<typeof KeyPublishResultSchema>;
export type LoginOptions = z.infer<typeof LoginOptionsSchema>;
export type LoginResult = z.infer<typeof LoginResultSchema>;
export type LogoutOptions = z.infer<typeof LogoutOptionsSchema>;
export type LogoutResult = z.infer<typeof LogoutResultSchema>;
export type InitOptions = z.infer<typeof InitOptionsSchema>;
export type InitResult = z.infer<typeof InitResultSchema>;
export type OverrideSection = z.infer<typeof OverrideSectionSchema>;
export type PhaseTiming = z.infer<typeof PhaseTimingSchema>;
export type SyncOptions = z.infer<typeof SyncOptionsSchema>;
export type SyncResult = z.infer<typeof SyncResultSchema>;
export type ImportOptions = z.infer<typeof ImportOptionsSchema>;
export type ImportResult = z.infer<typeof ImportResultSchema>;
export type ImportRouteDelta = z.infer<typeof ImportRouteDeltaSchema>;
export type ImportMigrationCollision = z.infer<typeof ImportMigrationCollisionSchema>;
export type ImportMigrationAppend = z.infer<typeof ImportMigrationAppendSchema>;
export type ImportMigrationReconciliation = z.infer<typeof ImportMigrationReconciliationSchema>;
export type UpgradeOptions = z.infer<typeof UpgradeOptionsSchema>;
export type UpgradeResult = z.infer<typeof UpgradeResultSchema>;
export type StatusResult = z.infer<typeof StatusResultSchema>;
export type TypesGenOptions = z.infer<typeof TypesGenOptionsSchema>;
export type TypesGenResult = z.infer<typeof TypesGenResultSchema>;
export type DbStudioOptions = z.infer<typeof DbStudioOptionsSchema>;
export type DbStudioResult = z.infer<typeof DbStudioResultSchema>;
export type DbDoctorOptions = z.infer<typeof DbDoctorOptionsSchema>;
export type DbDoctorResult = z.infer<typeof DbDoctorResultSchema>;
export type DbRepairOptions = z.infer<typeof DbRepairOptionsSchema>;
export type DbRepairResult = z.infer<typeof DbRepairResultSchema>;
export type RuntimeOverrideTarget = z.infer<typeof RuntimeOverrideTargetSchema>;
export type ProcessRole = z.infer<typeof ProcessRoleSchema>;
export type PidEntry = z.infer<typeof PidEntrySchema>;
export type PsResult = z.infer<typeof PsResultSchema>;
export type LogsOptions = z.infer<typeof LogsOptionsSchema>;
export type LogsResult = z.infer<typeof LogsResultSchema>;
export type KillOptions = z.infer<typeof KillOptionsSchema>;
export type KillResult = z.infer<typeof KillResultSchema>;
export type TypecheckOptions = z.infer<typeof TypecheckOptionsSchema>;
export type TypecheckResult = z.infer<typeof TypecheckResultSchema>;
export type TypecheckWorkspaceResult = z.infer<typeof TypecheckWorkspaceResultSchema>;
export type InfraExportOptions = z.infer<typeof InfraExportOptionsSchema>;
export type MfCheckOptions = z.infer<typeof MfCheckOptionsSchema>;
export type MfCheckResult = z.infer<typeof MfCheckResultSchema>;
export type InfraExportResult = z.infer<typeof InfraExportResultSchema>;
export type InfraExportService = z.infer<typeof InfraExportServiceSchema>;

export type CliCommandMeta = {
  commandPath?: string[];
  summary: string;
  description?: string;
  examples?: string[];
  interactive?: boolean;
  longRunning?: boolean;
  fields?: Record<string, { positional?: boolean; description?: string }>;
};

export const cliCommandMeta = {
  dev: {
    commandPath: ["dev"],
    summary: "Start a development session",
    interactive: true,
    longRunning: true,
  },
  start: {
    commandPath: ["start"],
    summary: "Start the production host",
    interactive: false,
    longRunning: true,
  },
  build: {
    commandPath: ["build"],
    summary: "Build selected workspaces",
    interactive: false,
    fields: {
      packages: { positional: true },
    },
  },
  config: {
    commandPath: ["config"],
    summary: "Print the loaded BOS configuration",
    interactive: false,
  },
  registryUse: {
    commandPath: ["registry", "use"],
    summary:
      "Compose app.ui/app.host/app.api/plugins.<key> sections from a published runtime into bos.config.json",
    interactive: false,
    fields: {
      from: { positional: true },
    },
  },
  pluginAdd: {
    commandPath: ["plugin", "add"],
    summary: "Add a plugin attachment",
    interactive: false,
    fields: {
      source: { positional: true },
    },
  },
  pluginRemove: {
    commandPath: ["plugin", "remove"],
    summary: "Remove a plugin attachment",
    interactive: false,
  },
  pluginList: {
    commandPath: ["plugin", "list"],
    summary: "List configured plugins",
    interactive: false,
  },
  pluginPublish: {
    commandPath: ["plugin", "publish"],
    summary: "Publish a single plugin",
    interactive: false,
  },
  publish: {
    commandPath: ["publish"],
    summary:
      "Publish the current workspace configuration (no build — use bos deploy for the full train)",
    interactive: false,
  },
  rollback: {
    commandPath: ["rollback"],
    summary: "Republish an earlier config snapshot from the registry publish history",
    interactive: true,
  },
  deploy: {
    commandPath: ["deploy"],
    summary:
      "Deploy train: preflight → build → upload bundles → publish config → runtime image (pre-pushed digest or local docker build) → post-publish smoke (optional) → Railway (image-backed, no build)",
    interactive: false,
  },
  smoke: {
    commandPath: ["smoke"],
    summary:
      "Boot a runtime image the way production boots (identity-driven, published config) and assert the boot surface: /health, SSR, OpenAPI spec, in-image mf check",
    interactive: false,
  },
  login: {
    commandPath: ["login"],
    summary:
      "Sign in with your NEAR account via the hosted site (wallet, passkey, or social login)",
    interactive: true,
  },
  logout: {
    commandPath: ["logout"],
    summary: "Revoke the stored CLI session and delete the exported publish key",
    interactive: false,
  },
  keyPublish: {
    commandPath: ["key", "generate"],
    summary: "Generate a publish access key",
    interactive: true,
  },
  init: {
    commandPath: ["init"],
    summary: "Scaffold a new project by extending a deployed app or template",
    interactive: true,
    fields: {
      domain: { positional: true },
    },
  },
  sync: {
    commandPath: ["sync"],
    summary: "Sync template files from parent project",
    interactive: false,
  },
  import: {
    commandPath: ["import"],
    summary: "Import a workspace subtree from an upstream repo without cloning",
    interactive: true,
    fields: {
      workspace: { positional: true },
    },
  },
  upgrade: {
    commandPath: ["upgrade"],
    summary: "Upgrade framework packages and sync template files",
    interactive: true,
  },
  typesGen: {
    commandPath: ["types", "gen"],
    summary: "Generate type definitions from configured API and plugin contracts",
    interactive: false,
  },
  typecheck: {
    commandPath: ["typecheck"],
    summary: "Run TypeScript type checking across all local workspaces",
    interactive: false,
    fields: {
      packages: { positional: true },
    },
  },
  mfCheck: {
    commandPath: ["mf", "check"],
    summary:
      "Verify Module Federation runtime compatibility across published host + plugin bundles",
    interactive: false,
  },
  platformManifest: {
    commandPath: ["platform", "manifest"],
    summary:
      "Show the platform release manifest — the booted host or the resolved release self-describes (ADR 0034)",
    interactive: false,
  },
  dbStudio: {
    commandPath: ["db", "studio"],
    summary: "Open Drizzle Studio for a plugin's database",
    fields: {
      plugin: { positional: true },
    },
  },
  dbDoctor: {
    commandPath: ["db", "doctor"],
    summary: "Diagnose migration health for a plugin's database",
    fields: {
      plugin: { positional: true },
    },
  },
  dbRepair: {
    commandPath: ["db", "repair"],
    summary: "Reset migration history and reapply migrations for a plugin",
    fields: {
      plugin: { positional: true },
    },
  },
  status: {
    commandPath: ["status"],
    summary: "Show project health, versions, and update availability",
    interactive: false,
  },
  ps: {
    commandPath: ["ps"],
    summary: "List tracked development processes",
    interactive: false,
  },
  logs: {
    commandPath: ["logs"],
    summary: "Read dev session logs (.bos/logs/dev-latest.log)",
    interactive: false,
  },
  kill: {
    commandPath: ["kill"],
    summary: "Stop tracked development processes",
    interactive: false,
  },
  infraExport: {
    commandPath: ["infra", "export"],
    summary: "Emit the resolved CI infra plan (env + services) for the current runtime",
    interactive: false,
  },
} as const satisfies Record<string, CliCommandMeta>;
