import {
  CORE_UI_PLUGIN_KEY,
  ComposePayloadSchema,
  type ConstructInput,
  constructTree as constructEngineTree,
} from "every-plugin/ui/manifest";
import { requireAdmin, requireSession } from "./auth-guards";

/**
 * The core ui's composition — the engine wired with the framework's default
 * mount guards. The wiring lives here (not on the generic ui/manifest
 * surface, which must import standalone) because both consumers execute
 * where the auth client is already present: the client boot and the
 * ./compose expose the host loads for SSR. input.guards overrides per mount.
 */
export { CORE_UI_PLUGIN_KEY, ComposePayloadSchema };
export const constructTree = (input: ConstructInput) =>
  constructEngineTree({
    ...input,
    guards: { authenticated: requireSession, admin: requireAdmin, ...input.guards },
  });
