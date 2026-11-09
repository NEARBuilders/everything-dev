/**
 * Re-export shim — the manifest engine lives in `every-plugin/ui/manifest`
 * (ADR 0008: generator + composition belong to the plugin lifecycle
 * package). This specifier is baked into generated routeConfig typeImports
 * and consumed by the host, ui, and tests, so it must keep resolving here.
 * The wrapped constructTree is the single place the framework's default
 * mount-guard wiring enters every composition path (client hydrate, host
 * SSR compose); callers may still override per mount via input.guards.
 */

import {
  type ConstructInput,
  constructTree as constructEngineTree,
} from "every-plugin/ui/manifest";
import { requireAdmin, requireSession } from "../auth-guards";

export * from "every-plugin/ui/manifest";
export * from "../remote-entry";

export const constructTree = (input: ConstructInput) =>
  constructEngineTree({
    ...input,
    guards: { authenticated: requireSession, admin: requireAdmin, ...input.guards },
  });
