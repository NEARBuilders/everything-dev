import * as z from "zod";
import { oc } from "./sdk";
import { BosConfigInputSchema, BosConfigSchema, SourceModeSchema } from "./types";

export const PhaseTimingSchema = z.object({
  name: z.string(),
  durationMs: z.number(),
});

export const DevOptionsSchema = z.object({
  host: SourceModeSchema.default("local"),
  ui: SourceModeSchema.default("local"),
  api: SourceModeSchema.default("local"),
  auth: SourceModeSchema.default("local"),
  remotePlugins: z.array(z.string()).optional(),
  proxy: z.boolean().default(false),
  ssr: z.boolean().default(false),
  port: z.number().optional(),
  apiPort: z.number().optional(),
  uiPort: z.number().optional(),
  authPort: z.number().optional(),
  pluginPortStart: z.number().optional(),
  interactive: z.boolean().optional(),
});

export const DevResultSchema = z.object({
  status: z.enum(["started", "error"]),
  description: z.string(),
  processes: z.array(z.string()),
  timings: z.array(PhaseTimingSchema).optional(),
});

export const StartOptionsSchema = z.object({
  port: z.number().optional(),
  interactive: z.boolean().optional(),
  account: z.string().optional(),
  domain: z.string().optional(),
  env: z.enum(["production", "staging"]).default("production"),
});

export const StartResultSchema = z.object({
  status: z.enum(["running", "error"]),
  url: z.string(),
  error: z.string().optional(),
});

export const BuildOptionsSchema = z.object({
  packages: z.string().default("all"),
  force: z.boolean().default(false),
  deploy: z.boolean().default(false),
});

export const BuildResultSchema = z.object({
  status: z.enum(["success", "error"]),
  built: z.array(z.string()),
  skipped: z.array(z.string()).optional(),
  deployed: z.boolean().optional(),
});

export const ConfigOptionsSchema = z.object({
  full: z.boolean().default(false),
});

export const ConfigResultSchema = z.object({
  config: z.union([BosConfigInputSchema, BosConfigSchema]).nullable(),
  packages: z.array(z.string()),
  remotes: z.array(z.string()),
  full: z.boolean().default(false),
});

export const PluginAddOptionsSchema = z.object({
  source: z.string(),
  as: z.string().optional(),
  production: z.string().optional(),
});

export const PluginAddResultSchema = z.object({
  status: z.enum(["added", "error"]),
  key: z.string(),
  development: z.string().optional(),
  production: z.string().optional(),
  integrity: z.string().optional(),
  version: z.string().optional(),
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
  script: z.string().optional(),
  production: z.string().optional(),
  integrity: z.string().optional(),
  version: z.string().optional(),
  error: z.string().optional(),
});

export const WorkspaceDeployResultSchema = z.object({
  key: z.string(),
  kind: z.enum(["app", "plugin"]),
  success: z.boolean(),
  url: z.string().optional(),
  error: z.string().optional(),
  warnings: z.array(z.string()).optional(),
  durationMs: z.number().optional(),
  retried: z.boolean().optional(),
});

export const PublishOptionsSchema = z.object({
  deploy: z.boolean().default(false),
  dryRun: z.boolean().default(false),
  verbose: z.boolean().default(false),
  packages: z.string().default("all"),
  network: z.enum(["mainnet", "testnet"]).optional(),
  privateKey: z.string().optional(),
  env: z.enum(["production", "staging"]).default("production"),
});

export const PublishResultSchema = z.object({
  status: z.enum(["published", "error", "dry-run"]),
  registryUrl: z.string(),
  txHash: z.string().optional(),
  error: z.string().optional(),
  built: z.array(z.string()).optional(),
  skipped: z.array(z.string()).optional(),
  deployResults: z.array(WorkspaceDeployResultSchema).optional(),
});

export const DeployOptionsSchema = z.object({
  env: z.enum(["production", "staging"]).default("production"),
  build: z.boolean().default(true),
  dryRun: z.boolean().default(false),
  verbose: z.boolean().default(false),
  packages: z.string().default("all"),
  network: z.enum(["mainnet", "testnet"]).optional(),
  privateKey: z.string().optional(),
  service: z.string().optional(),
});

export const DeployResultSchema = z.object({
  status: z.enum(["deployed", "published", "error", "dry-run"]),
  registryUrl: z.string(),
  txHash: z.string().optional(),
  built: z.array(z.string()).optional(),
  skipped: z.array(z.string()).optional(),
  redeployed: z.boolean(),
  service: z.string().optional(),
  error: z.string().optional(),
  deployResults: z.array(WorkspaceDeployResultSchema).optional(),
});

export const KeyPublishOptionsSchema = z.object({
  allowance: z.string().default("0.25NEAR"),
});

export const KeyPublishResultSchema = z.object({
  status: z.enum(["published", "error"]),
  account: z.string(),
  network: z.enum(["mainnet", "testnet"]),
  contract: z.string(),
  allowance: z.string(),
  functionNames: z.array(z.string()),
  publicKey: z.string().optional(),
  privateKey: z.string().optional(),
  error: z.string().optional(),
});

export const OverrideSectionSchema = z.enum(["ui", "api", "host", "plugins"]);

export const RuntimeOverrideTargetBaseSchema = z.enum(["ui", "api", "plugins"]);

export const RuntimeOverrideTargetSchema = z.union([
  RuntimeOverrideTargetBaseSchema,
  z.string().regex(/^plugins\.(\*|[a-z0-9_-]+)$/),
]);

export const InitOptionsSchema = z.object({
  extends: z.string().optional(),
  directory: z.string().optional(),
  account: z.string().optional(),
  domain: z.string().optional(),
  source: z.string().optional(),
  plugins: z.array(z.string()).optional(),
  overrides: z.array(OverrideSectionSchema).optional(),
  noInteractive: z.boolean().default(false),
  noInstall: z.boolean().default(false),
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
  dryRun: z.boolean().default(false),
  noInstall: z.boolean().default(false),
});

export const SyncResultSchema = z.object({
  status: z.enum(["synced", "dry-run", "error"]),
  updated: z.array(z.string()),
  skipped: z.array(z.string()),
  added: z.array(z.string()),
  error: z.string().optional(),
});

export const UpgradeOptionsSchema = z.object({
  dryRun: z.boolean().default(false),
  noInstall: z.boolean().default(false),
  noSync: z.boolean().default(false),
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
  timings: z.array(PhaseTimingSchema).optional(),
  changelogUrl: z.string().optional(),
  error: z.string().optional(),
});

export const StatusResultSchema = z.object({
  status: z.enum(["ok", "error"]),
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
  env: z.enum(["development", "production"]).optional(),
  dryRun: z.boolean().default(false),
});

export const TypesGenResultSchema = z.object({
  status: z.enum(["success", "error"]),
  generated: z.array(z.string()),
  fetched: z.array(z.string()),
  skipped: z.array(z.string()),
  failed: z.array(z.string()),
  source: z.enum(["local", "remote"]).optional(),
  error: z.string().optional(),
});

export const DbStudioOptionsSchema = z.object({
  plugin: z.string().default("api"),
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
  plugin: z.string(),
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
  plugin: z.string(),
  mode: z.enum(["history-reset", "recreate"]).default("history-reset"),
  yes: z.boolean().optional(),
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

export const KillOptionsSchema = z.object({
  configDir: z.string().optional(),
  signal: z.enum(["SIGTERM", "SIGKILL"]).default("SIGTERM"),
  all: z.boolean().default(false),
});

export const KillResultSchema = z.object({
  status: z.enum(["killed", "error"]),
  killed: z.array(z.object({ pid: z.number(), configDir: z.string() })),
  skipped: z.array(z.object({ pid: z.number(), reason: z.string() })),
  error: z.string().optional(),
});

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
  deploy: oc
    .route({ method: "POST", path: "/deploy" })
    .input(DeployOptionsSchema)
    .output(DeployResultSchema),
  keyPublish: oc
    .route({ method: "POST", path: "/key/publish" })
    .input(KeyPublishOptionsSchema)
    .output(KeyPublishResultSchema),
  init: oc
    .route({ method: "POST", path: "/init" })
    .input(InitOptionsSchema)
    .output(InitResultSchema),
  sync: oc
    .route({ method: "POST", path: "/sync" })
    .input(SyncOptionsSchema)
    .output(SyncResultSchema),
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
  kill: oc
    .route({ method: "POST", path: "/kill" })
    .input(KillOptionsSchema)
    .output(KillResultSchema),
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
export type DeployOptions = z.infer<typeof DeployOptionsSchema>;
export type DeployResult = z.infer<typeof DeployResultSchema>;
export type KeyPublishOptions = z.infer<typeof KeyPublishOptionsSchema>;
export type KeyPublishResult = z.infer<typeof KeyPublishResultSchema>;
export type InitOptions = z.infer<typeof InitOptionsSchema>;
export type InitResult = z.infer<typeof InitResultSchema>;
export type OverrideSection = z.infer<typeof OverrideSectionSchema>;
export type PhaseTiming = z.infer<typeof PhaseTimingSchema>;
export type SyncOptions = z.infer<typeof SyncOptionsSchema>;
export type SyncResult = z.infer<typeof SyncResultSchema>;
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
export type KillOptions = z.infer<typeof KillOptionsSchema>;
export type KillResult = z.infer<typeof KillResultSchema>;
