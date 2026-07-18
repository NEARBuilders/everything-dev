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
    fields: {
      remotePlugins: {
        description:
          "Comma-separated plugin IDs to force remote (e.g. --remote-plugins auth,registry)",
      },
    },
  },
  start: {
    commandPath: ["start"],
    summary: "Start the production host",
    interactive: false,
    longRunning: true,
    fields: {
      env: { description: "Environment: production or staging" },
    },
  },
  build: {
    commandPath: ["build"],
    summary: "Build selected workspaces",
    interactive: false,
    fields: {
      packages: { positional: true, description: "Comma-separated package list" },
    },
  },
  config: {
    commandPath: ["config"],
    summary: "Print the loaded BOS configuration",
    interactive: false,
    fields: {
      full: { description: "Print the fully resolved configuration" },
    },
  },
  pluginAdd: {
    commandPath: ["plugin", "add"],
    summary: "Add a plugin attachment",
    interactive: false,
    fields: {
      source: {
        positional: true,
        description: "Plugin source (local:path, bos://account/domain, or URL)",
      },
      as: { description: "Plugin alias" },
      production: { description: "Production URL override" },
    },
  },
  pluginRemove: {
    commandPath: ["plugin", "remove"],
    summary: "Remove a plugin attachment",
    interactive: false,
    fields: { key: { positional: true, description: "Plugin key" } },
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
    fields: { key: { positional: true, description: "Plugin key" } },
  },
  publish: {
    commandPath: ["publish"],
    summary: "Publish the current workspace configuration",
    interactive: false,
    fields: {
      deploy: { description: "Build and deploy all workspaces before publish" },
      dryRun: { description: "Preview what would be published without writing" },
      verbose: { description: "Show full build output instead of clean summary" },
      env: { description: "Environment: production or staging" },
      network: { description: "NEAR network: mainnet or testnet" },
    },
  },
  deploy: {
    commandPath: ["deploy"],
    summary: "Publish config and trigger Railway redeploy",
    interactive: false,
    fields: {
      env: { description: "Environment: production or staging" },
      build: { description: "Build and deploy workspaces before publish (default: true)" },
      dryRun: { description: "Preview what would be deployed without writing" },
      verbose: { description: "Show full build output instead of clean summary" },
      service: { description: "Override Railway service name from config" },
    },
  },
  keyPublish: {
    commandPath: ["key", "publish"],
    summary: "Generate a publish access key",
    interactive: false,
  },
  init: {
    commandPath: ["init"],
    summary: "Scaffold a new project by extending a deployed app or template",
    interactive: true,
    fields: {
      domain: {
        positional: true,
        description: "New project domain (e.g. myapp.everything.dev)",
      },
      extends: {
        description: "Parent to extend from (e.g. bos://account/gateway or account/gateway)",
      },
      account: { description: "New project NEAR account (auto-derived from extends)" },
      directory: { description: "Target directory (auto-derived from domain)" },
      source: { description: "Local source dir (skips GitHub download)" },
      plugins: {
        description: "Comma-separated plugin keys to include (requires --overrides=plugins)",
      },
      overrides: {
        description: "Comma-separated sections to customize locally: ui,api,host,plugins",
      },
      noInteractive: { description: "Skip prompts, use flags only" },
      noInstall: { description: "Skip bun install" },
    },
  },
  sync: {
    commandPath: ["sync"],
    summary: "Sync template files from parent project",
    interactive: false,
    fields: {
      dryRun: { description: "Preview changes without writing files" },
      noInstall: { description: "Skip bun install" },
    },
  },
  upgrade: {
    commandPath: ["upgrade"],
    summary: "Upgrade framework packages and sync template files",
    interactive: true,
    fields: {
      dryRun: { description: "Preview changes without writing" },
      noInstall: { description: "Skip bun install" },
      noSync: { description: "Only upgrade packages, skip template sync" },
    },
  },
  typesGen: {
    commandPath: ["types", "gen"],
    summary: "Generate type definitions from configured API and plugin contracts",
    interactive: false,
    fields: {
      env: { description: "Environment: development (default) or production" },
      dryRun: { description: "Preview what would be fetched without writing files" },
    },
  },
  dbStudio: {
    commandPath: ["db", "studio"],
    summary: "Open Drizzle Studio for a plugin's database",
    fields: {
      plugin: {
        positional: true,
        description: "Plugin key: api, auth, or a plugin name (default: api)",
      },
    },
  },
  dbDoctor: {
    commandPath: ["db", "doctor"],
    summary: "Diagnose migration health for a plugin's database",
    fields: {
      plugin: {
        positional: true,
        description: "Plugin key: api, auth, or a plugin name",
      },
    },
  },
  dbRepair: {
    commandPath: ["db", "repair"],
    summary: "Reset migration history and reapply migrations for a plugin",
    fields: {
      plugin: {
        positional: true,
        description: "Plugin key: api, auth, or a plugin name",
      },
      mode: {
        description: "Repair mode: history-reset (default) or recreate (not yet supported)",
      },
      yes: {
        description: "Skip confirmation prompt",
      },
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
  kill: {
    commandPath: ["kill"],
    summary: "Stop tracked development processes",
    interactive: false,
    fields: {
      configDir: { description: "Kill processes owned by a config directory (defaults to cwd)" },
      signal: { description: "Signal: SIGTERM (default) or SIGKILL" },
      all: { description: "Kill processes across all config directories" },
    },
  },
} as const satisfies Record<string, CliCommandMeta>;
