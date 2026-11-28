/**
 * The app-authoring DSL — a curated, audited list. `App` is consumed by
 * generated child-repo code (`author-config` emit); the schema/resolve
 * sections are the descriptor pipeline's public types.
 *
 * Sections:
 *  - constructors — the builder verbs a child repo's app.config.ts calls
 *  - resolve — descriptor → config input resolution
 *  - schema — zod schemas + inferred types for every descriptor slot
 *  - serialize — source-level serialization (emitted into child repos)
 */

// constructors
export { API, App, applyDevOverlay, Plugin, UI } from "./constructors";
export type { AppDeployEntry, DeployMap } from "./resolve";
// resolve
export {
  ATTACHMENT_FIELDS,
  configInputToDescriptor,
  LOCAL_PREFIX,
  PLUGIN_ATTACHMENT_FIELDS,
  resolveApp,
  resolveApps,
  SLOT_INPUT_FIELDS,
  toConfigInput,
} from "./resolve";
export type {
  ApiInput,
  ApiRef,
  AppDescriptor,
  AppInput,
  AppRegistry,
  AttachmentInput,
  AttachmentRef,
  HostInput,
  HostRef,
  PipelineFields,
  PluginAttachmentRef,
  UiInput,
  UiRef,
} from "./schema";
// schema
export {
  ApiRefSchema,
  AppDescriptorSchema,
  AttachmentRefSchema,
  HostRefSchema,
  PipelineFieldsSchema,
  PluginAttachmentRefSchema,
  UiRefSchema,
} from "./schema";
// serialize
export { serializeAppDescriptorSource } from "./serialize";
