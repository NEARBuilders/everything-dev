import * as z from "zod";
import { JsonObjectSchema, SharedDepMapSchema } from "../types";

/** Pipeline-owned fields — never authored; injected from the deploy map. */
export const PipelineFieldsSchema = z.object({
  production: z.string().optional(),
  integrity: z.string().optional(),
  ssr: z.string().optional(),
  ssrIntegrity: z.string().optional(),
});
export type PipelineFields = z.infer<typeof PipelineFieldsSchema>;

const DevelopmentRefSchema = z.object({
  /** local workspace directory, relative to the App root — emitted as `local:<path>` */
  path: z.string().optional(),
  /** explicit development ref override (e.g. a remote dev URL) */
  development: z.string().optional(),
});

/** An attached App (today's `plugins.<id>` / `app.auth` entries). */
export const AttachmentRefSchema = DevelopmentRefSchema.extend({
  name: z.string().optional(),
  /** published module reference (bos://…) consumed by resolution */
  extends: z.string().optional(),
  proxy: z.string().optional(),
  variables: JsonObjectSchema.optional(),
  secrets: z.array(z.string()).optional(),
  routes: z.array(z.string()).optional(),
  shared: SharedDepMapSchema.optional(),
  connectSrc: z.array(z.string()).optional(),
  dependsOn: z.array(z.string()).optional(),
  version: z.string().optional(),
  ui: z
    .object({
      name: z.string().optional(),
      path: z.string().optional(),
      development: z.string().optional(),
      integrity: z.string().optional(),
    })
    .strict()
    .optional(),
});
export type AttachmentRef = z.infer<typeof AttachmentRefSchema>;
export type AttachmentInput = AttachmentRef;

/** The `app.api` slot. */
export const ApiRefSchema = DevelopmentRefSchema.extend({
  proxy: z.string().optional(),
  variables: JsonObjectSchema.optional(),
  secrets: z.array(z.string()).optional(),
  routes: z.array(z.string()).optional(),
  shared: SharedDepMapSchema.optional(),
  dependsOn: z.array(z.string()).optional(),
}).strict();
export type ApiRef = z.infer<typeof ApiRefSchema>;
export type ApiInput = ApiRef;

/** The `app.ui` slot — pipeline fields (production/integrity/ssr) come from the deploy map. */
export const UiRefSchema = DevelopmentRefSchema.strict();
export type UiRef = z.infer<typeof UiRefSchema>;
export type UiInput = UiRef;

/** The `app.host` slot — production/integrity come from the deploy map. */
export const HostRefSchema = DevelopmentRefSchema.extend({
  secrets: z.array(z.string()).optional(),
}).strict();
export type HostRef = z.infer<typeof HostRefSchema>;
export type HostInput = HostRef;

/**
 * The authored App — pure data, the boot input. Local paths only (dev
 * authoring shape); deployment resolves them through the deploy map.
 */
export const AppDescriptorSchema = z
  .object({
    name: z.string(),
    /**
     * The base App this App inherits (child-wins): a registry name
     * (`"everything.dev"`) or an imported App descriptor value — an imported
     * parent is an inlined parent (same-repo composition; the resolved shape
     * is identical to a fetched one). The value is validated and depth-guarded
     * at resolution (flattenParent re-parses it); chains deeper than one
     * level are deferred (wayfinder ticket 08).
     */
    extends: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
    account: z.string().optional(),
    domain: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    repository: z.string().optional(),
    testnet: z.string().optional(),
    staging: z
      .object({
        domain: z.string(),
        account: z.string().optional(),
      })
      .strict()
      .optional(),
    ci: z
      .object({
        railway: z
          .object({
            service: z.string(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    publish: z
      .object({
        auth: z.enum(["session", "key", "custody"]).optional(),
      })
      .strict()
      .optional(),
    host: HostRefSchema.optional(),
    api: ApiRefSchema.optional(),
    ui: UiRefSchema.optional(),
    /** attachment landing in the `app.auth` slot */
    auth: AttachmentRefSchema.optional(),
    plugins: z.record(z.string(), AttachmentRefSchema).optional(),
  })
  .strict();
export type AppDescriptor = z.infer<typeof AppDescriptorSchema>;
export type AppInput = AppDescriptor;

export type AppRegistry = Record<string, AppInput>;
