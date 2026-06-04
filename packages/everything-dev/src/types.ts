import * as z from "zod";

export type JsonPrimitive = string | number | boolean | null;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);
export const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

export const ExtendsSchema = z.union([
  z.string(),
  z.object({
    development: z.string().optional(),
    production: z.string().optional(),
    staging: z.string().optional(),
  }),
]);
export type Extends = z.infer<typeof ExtendsSchema>;
export type ExtendsConfig = Extract<Extends, Record<string, string | undefined>>;

export const SourceModeSchema = z.enum(["local", "remote"]);
export type SourceMode = z.infer<typeof SourceModeSchema>;

export const SharedConfigSchema = z.object({
  version: z.string(),
  requiredVersion: z.string().optional(),
  singleton: z.boolean().optional(),
  eager: z.boolean().optional(),
  strictVersion: z.boolean().optional(),
  shareScope: z.string().optional(),
});
export type SharedConfig = z.infer<typeof SharedConfigSchema>;
export type SharedDepConfig = SharedConfig;
export const SharedDepConfigSchema = SharedConfigSchema;

export const FederationEntrySchema = z.object({
  name: z.string(),
  url: z.string(),
  entry: z.string(),
  source: SourceModeSchema,
  integrity: z.string().optional(),
});
export type FederationEntry = z.infer<typeof FederationEntrySchema>;

export const SidebarRoleSchema = z.enum(["anon", "member", "admin"]);
export type SidebarRole = z.infer<typeof SidebarRoleSchema>;

export const SidebarItemSchema = z.object({
  icon: z.string(),
  label: z.string(),
  to: z.string().optional(),
  roleRequired: SidebarRoleSchema.optional(),
});
export type SidebarItem = z.infer<typeof SidebarItemSchema>;

export const ComposableAppEntrySchema = z.object({
  extends: ExtendsSchema.optional(),
  name: z.string().optional(),
  development: z.string().optional(),
  production: z.string().optional(),
  integrity: z.string().optional(),
  proxy: z.string().optional(),
  variables: JsonObjectSchema.optional(),
  secrets: z.array(z.string()).optional(),
  sidebar: z.array(SidebarItemSchema).optional(),
  routes: z.array(z.string()).optional(),
});
export type ComposableAppEntry = z.infer<typeof ComposableAppEntrySchema>;

export const ApiPluginConfigSchema = ComposableAppEntrySchema;
export type ApiPluginConfig = z.infer<typeof ApiPluginConfigSchema>;

export const PluginUiConfigSchema = z.object({
  name: z.string(),
  development: z.string().optional(),
  production: z.string().optional(),
  integrity: z.string().optional(),
});
export type PluginUiConfig = z.infer<typeof PluginUiConfigSchema>;

export const BosPluginRefSchema = ComposableAppEntrySchema.extend({
  version: z.string().optional(),
  app: z.record(z.string(), z.unknown()).optional(),
  shared: z.record(z.string(), z.record(z.string(), SharedConfigSchema)).optional(),
  plugins: z.record(z.string(), z.unknown()).optional(),
});
export type BosPluginRef = z.infer<typeof BosPluginRefSchema>;
export type PluginEntryValue = string | BosPluginRef;
export type PluginEntries = Record<string, PluginEntryValue>;

const PluginRuntimeUiSchema = z.object({
  name: z.string(),
  url: z.string(),
  entry: z.string(),
  source: SourceModeSchema,
  localPath: z.string().optional(),
  port: z.number().optional(),
  integrity: z.string().optional(),
});
export type PluginRuntimeUi = z.infer<typeof PluginRuntimeUiSchema>;

export const RuntimePluginConfigSchema = z.object({
  name: z.string(),
  url: z.string(),
  entry: z.string(),
  source: SourceModeSchema,
  localPath: z.string().optional(),
  port: z.number().optional(),
  proxy: z.string().optional(),
  variables: JsonObjectSchema.optional(),
  secrets: z.array(z.string()).optional(),
  integrity: z.string().optional(),
  ui: PluginRuntimeUiSchema.optional(),
  sidebar: z.array(SidebarItemSchema).optional(),
  routes: z.array(z.string()).optional(),
});
export type RuntimePluginConfig = z.infer<typeof RuntimePluginConfigSchema>;

export const UiConfigSchema = z.object({
  name: z.string().optional(),
  development: z.string().optional(),
  production: z.string().optional(),
  integrity: z.string().optional(),
  ssr: z.string().optional(),
  ssrIntegrity: z.string().optional(),
});
export type UiConfig = z.infer<typeof UiConfigSchema>;

export const HostConfigSchema = z.object({
  development: z.string(),
  production: z.string(),
  integrity: z.string().optional(),
  secrets: z.array(z.string()).optional(),
});
export type HostConfig = z.infer<typeof HostConfigSchema>;

export const ClientRuntimeInfoSchema = z.object({
  accountId: z.string(),
  gatewayId: z.string(),
  runtimeBasePath: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  hostUrl: z.string().nullable(),
});
export type ClientRuntimeInfo = z.infer<typeof ClientRuntimeInfoSchema>;

export const RuntimeLineageSchema = z.object({
  parent: z.string().nullable(),
  root: z.string().nullable(),
  depth: z.number().int().nonnegative(),
  extendsChain: z.array(z.string()),
});
export type RuntimeLineage = z.infer<typeof RuntimeLineageSchema>;

export const BosStagingSchema = z.object({
  domain: z.string(),
});
export type BosStaging = z.infer<typeof BosStagingSchema>;

const BosConfigInputAppEntrySchema = z.record(z.string(), z.unknown());
export type BosConfigInputAppEntry = z.infer<typeof BosConfigInputAppEntrySchema>;

export const BosConfigInputSchema: z.ZodType<BosConfigInput> = z.lazy(() =>
  z.object({
    extends: ExtendsSchema.optional(),
    account: z.string().optional(),
    domain: z.string().optional(),
    testnet: z.string().optional(),
    template: z.string().optional(),
    gateway: z
      .object({
        development: z.string().optional(),
        production: z.string().optional(),
        account: z.string().optional(),
      })
      .optional(),
    development: z.string().optional(),
    production: z.string().optional(),
    integrity: z.string().optional(),
    name: z.string().optional(),
    version: z.string().optional(),
    proxy: z.string().optional(),
    variables: JsonObjectSchema.optional(),
    secrets: z.array(z.string()).optional(),
    routes: z.array(z.string()).optional(),
    sidebar: z.array(SidebarItemSchema).optional(),
    app: z.record(z.string(), BosConfigInputAppEntrySchema).optional(),
    shared: z.record(z.string(), z.record(z.string(), SharedConfigSchema)).optional(),
    plugins: z.record(z.string(), z.union([z.string(), BosConfigInputSchema])).optional(),
    ci: CiConfigSchema.optional(),
  }),
);

export interface BosConfigInput {
  extends?: string | ExtendsConfig;
  account?: string;
  domain?: string;
  title?: string;
  description?: string;
  testnet?: string;
  template?: string;
  gateway?: {
    development?: string;
    production?: string;
    account?: string;
  };
  development?: string;
  production?: string;
  integrity?: string;
  name?: string;
  version?: string;
  proxy?: string;
  variables?: JsonObject;
  secrets?: string[];
  routes?: string[];
  sidebar?: SidebarItem[];
  app?: Record<string, BosConfigInputAppEntry>;
  shared?: Record<string, Record<string, SharedDepConfig>>;
  plugins?: Record<string, string | BosConfigInput>;
  ci?: CiConfig;
}

export const RailwayCiSchema = z.object({
  service: z.string(),
});
export type RailwayCi = z.infer<typeof RailwayCiSchema>;

export const CiConfigSchema = z.object({
  railway: RailwayCiSchema.optional(),
});
export type CiConfig = z.infer<typeof CiConfigSchema>;

export const BosConfigSchema = z.object({
  account: z.string(),
  extends: ExtendsSchema.optional(),
  domain: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  testnet: z.string().optional(),
  staging: BosStagingSchema.optional(),
  repository: z.string().optional(),
  ci: CiConfigSchema.optional(),
  shared: z.record(z.string(), z.record(z.string(), SharedConfigSchema)).optional(),
  plugins: z.record(z.string(), z.union([z.string(), BosPluginRefSchema])).optional(),
  app: z.object({
    host: HostConfigSchema,
    ui: UiConfigSchema,
    api: ComposableAppEntrySchema,
    auth: ComposableAppEntrySchema.optional(),
  }),
});
export type BosConfig = z.infer<typeof BosConfigSchema>;

export const RuntimeConfigSchema = z.object({
  env: z.enum(["development", "production", "staging"]),
  account: z.string(),
  domain: z.string().optional(),
  networkId: z.enum(["mainnet", "testnet"]),
  title: z.string().optional(),
  description: z.string().optional(),
  repository: z.string().optional(),
  host: FederationEntrySchema.extend({
    localPath: z.string().optional(),
    port: z.number().optional(),
    secrets: z.array(z.string()).optional(),
    remoteUrl: z.string().optional(),
  }),
  shared: z
    .object({
      ui: z.record(z.string(), SharedConfigSchema).optional(),
      plugins: z.record(z.string(), SharedConfigSchema).optional(),
    })
    .optional(),
  ui: FederationEntrySchema.extend({
    localPath: z.string().optional(),
    port: z.number().optional(),
    ssrUrl: z.string().optional(),
    ssrIntegrity: z.string().optional(),
  }),
  api: FederationEntrySchema.extend({
    localPath: z.string().optional(),
    port: z.number().optional(),
    proxy: z.string().optional(),
    variables: JsonObjectSchema.optional(),
    secrets: z.array(z.string()).optional(),
  }),
  auth: FederationEntrySchema.extend({
    localPath: z.string().optional(),
    port: z.number().optional(),
    proxy: z.string().optional(),
    variables: JsonObjectSchema.optional(),
    secrets: z.array(z.string()).optional(),
    sidebar: z.array(SidebarItemSchema).optional(),
  }).optional(),
  plugins: z.record(z.string(), RuntimePluginConfigSchema).optional(),
});
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

export const ClientRuntimeConfigSchema = z.object({
  env: z.enum(["development", "production", "staging"]),
  account: z.string(),
  networkId: z.enum(["mainnet", "testnet"]),
  hostUrl: z.string().optional(),
  assetsUrl: z.string(),
  apiBase: z.string(),
  rpcBase: z.string(),
  repository: z.string().optional(),
  authAvailable: z.boolean().optional(),
  runtime: ClientRuntimeInfoSchema.optional(),
  ui: z
    .object({
      name: z.string(),
      url: z.string(),
      entry: z.string(),
      integrity: z.string().optional(),
    })
    .optional(),
  api: z
    .object({
      name: z.string(),
      url: z.string(),
      entry: z.string(),
      integrity: z.string().optional(),
    })
    .optional(),
  auth: z
    .object({
      name: z.string(),
      url: z.string(),
      entry: z.string(),
      integrity: z.string().optional(),
      sidebar: z.array(SidebarItemSchema).optional(),
    })
    .optional(),
  plugins: z
    .record(
      z.string(),
      z.object({
        name: z.string(),
        url: z.string(),
        entry: z.string(),
        integrity: z.string().optional(),
        ui: z
          .object({
            name: z.string(),
            url: z.string(),
            entry: z.string(),
            source: SourceModeSchema,
            integrity: z.string().optional(),
          })
          .optional(),
        sidebar: z.array(SidebarItemSchema).optional(),
      }),
    )
    .optional(),
});
export type ClientRuntimeConfig = z.infer<typeof ClientRuntimeConfigSchema>;
