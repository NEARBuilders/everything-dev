/**
 * Re-export shim — the manifest engine lives in `every-plugin/ui/manifest`
 * (ADR 0008: generator + composition belong to the plugin lifecycle
 * package). This specifier is baked into generated routeConfig typeImports
 * and consumed by the host, ui, and tests, so it must keep resolving here.
 */

export * from "every-plugin/ui/manifest";
