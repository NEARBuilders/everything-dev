import { Effect } from "effect";
import type { PluginInventory } from "../domain";
import { AuditStepError } from "../domain";
import { readText, writeText } from "../fs";

interface BosConfig {
  readonly extends?: string;
  readonly account?: string;
  readonly domain?: string;
  readonly title?: string;
  readonly description?: string;
  readonly testnet?: unknown;
  readonly staging?: unknown;
  readonly repository?: string;
  readonly ci?: unknown;
  readonly app?: {
    readonly ui?: { readonly development?: string };
    readonly api?: { readonly development?: string; readonly secrets?: string[] };
  };
  readonly plugins?: Record<
    string,
    {
      readonly development?: string;
      readonly extends?: string;
      readonly variables?: Record<string, unknown>;
      readonly secrets?: string[];
    }
  >;
}

export interface StepResult {
  readonly writes: readonly string[];
  readonly deletes: readonly string[];
  readonly notes: readonly string[];
}

const targetedRef = (ref: string, key: string): string =>
  ref.includes("#") ? ref : `${ref}#plugins.${key}`;

const translatePlugins = (config: BosConfig): Record<string, unknown> => {
  const plugins: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(config.plugins ?? {})) {
    const development = typeof entry.development === "string" ? entry.development : "";
    const localMatch = development.match(/^local:plugins\/([^/]+)$/);
    if (localMatch) {
      plugins[key] = {
        path: `plugins/${localMatch[1]}`,
        ...(entry.variables ? { variables: entry.variables } : {}),
        ...(entry.secrets ? { secrets: entry.secrets } : {}),
      };
      continue;
    }
    if (typeof entry.extends === "string") {
      plugins[key] = {
        extends: targetedRef(entry.extends, key),
        ...(entry.variables ? { variables: entry.variables } : {}),
      };
      continue;
    }
    plugins[key] = { extends: targetedRef(`${config.extends}`, key) };
  }
  return plugins;
};

const descriptorBody = (config: BosConfig, _inventory: readonly PluginInventory[]) => {
  const localApi = config.app?.api?.development === "local:api";
  const localUi = config.app?.ui?.development === "local:ui";
  return {
    name: config.domain,
    extends: config.extends,
    account: config.account,
    domain: config.domain,
    ...(config.title ? { title: config.title } : {}),
    ...(config.description ? { description: config.description } : {}),
    ...(config.testnet ? { testnet: config.testnet } : {}),
    ...(config.staging ? { staging: config.staging } : {}),
    ...(config.repository ? { repository: config.repository } : {}),
    ...(config.ci ? { ci: config.ci } : {}),
    ...(localUi ? { ui: { path: "ui" } } : {}),
    ...(localApi
      ? {
          api: {
            path: "api",
            secrets: config.app?.api?.secrets ?? [],
          },
        }
      : {}),
    plugins: translatePlugins(config),
  };
};

const renderBosAppTs = (body: Record<string, unknown>): string =>
  [
    'import { App } from "everything-dev/descriptor";',
    "",
    "// Authored app descriptor. The published config is canonicalized to JSON",
    "// from this file; dev-only overrides live in bos.dev.ts (never published).",
    `export default App(${JSON.stringify(body, null, 2)});`,
    "",
  ].join("\n");

const renderBosDevTs = (): string =>
  [
    'import type { AppDescriptor } from "everything-dev/descriptor";',
    "",
    "/**",
    " * Dev overlay for the everything.dev runtime (bos.app.ts) — merged",
    " * child-wins over the resolved config when the environment is development.",
    " * Never published.",
    " */",
    "export default {} satisfies Partial<AppDescriptor>;",
    "",
  ].join("\n");

export const authorConfig = (
  projectDir: string,
  inventory: readonly PluginInventory[],
  dryRun: boolean,
): Effect.Effect<StepResult, Error> =>
  Effect.gen(function* () {
    const config = JSON.parse(yield* readText(projectDir, "bos.config.json")) as BosConfig;
    if (!config.extends || !config.account || !config.domain) {
      return yield* new AuditStepError({
        step: "author-config",
        message:
          "bos.config.json missing extends/account/domain — audit gate should have caught this",
      });
    }

    const bosApp = renderBosAppTs(descriptorBody(config, inventory));
    const bosDev = renderBosDevTs();

    if (dryRun) {
      return {
        writes: ["bos.app.ts", "bos.dev.ts"],
        deletes: [],
        notes: [
          "bos.config.json deletion deferred until after first successful types:gen from the descriptor",
        ],
      };
    }
    yield* writeText(projectDir, "bos.app.ts", bosApp);
    yield* writeText(projectDir, "bos.dev.ts", bosDev);
    return {
      writes: ["bos.app.ts", "bos.dev.ts"],
      deletes: [],
      notes: [
        "bos.config.json deletion deferred until after first successful types:gen from the descriptor",
      ],
    };
  });
