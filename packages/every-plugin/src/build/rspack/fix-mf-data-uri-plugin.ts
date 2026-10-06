import type { Compiler, RspackPluginInstance } from "@rspack/core";

const MF_DATA_URI_MARKER = "data:text/javascript,";

const MF_ABSOLUTE_IMPORT_RE = /(["'])\/[^"']*?\/node_modules\/(@module-federation\/[^"']*)/g;

export class FixMfDataUriPlugin implements RspackPluginInstance {
  name = "FixMfDataUriPlugin";

  apply(compiler: Compiler) {
    compiler.hooks.compilation.tap(this.name, (_compilation, { normalModuleFactory }) => {
      normalModuleFactory.hooks.beforeResolve.tap(this.name, (resolveData) => {
        if (!resolveData?.request) return;
        resolveData.request = rewriteMfDataUriRequest(resolveData.request);
      });
    });
  }
}

/**
 * The MF runtime's generated data-URI module imports its runtime pieces by
 * absolute node_modules paths (`require.resolve` output), which differ per
 * machine. Rewriting them to bare specifiers keeps the module — and therefore
 * the module id space — machine-independent; `mfDataUriAliases()` points the
 * specifiers back at their on-disk targets for resolution.
 *
 * Only `@module-federation/*` imports are rewritten: other data-URI entries
 * (e.g. Rsbuild's dev HMR client, `@rsbuild/core/dist/client/hmr.js`) import
 * subpaths their package's exports map does not expose, so stripping their
 * absolute prefix makes them unresolvable.
 */
export function rewriteMfDataUriRequest(request: string): string {
  const idx = request.indexOf(MF_DATA_URI_MARKER);
  if (idx === -1) return request;

  const contentStart = idx + MF_DATA_URI_MARKER.length;
  const prefix = request.substring(0, contentStart);
  const decoded = safeDecode(request.substring(contentStart));
  return prefix + encodeURIComponent(decoded.replace(MF_ABSOLUTE_IMPORT_RE, "$1$2"));
}

function safeDecode(content: string): string {
  try {
    return decodeURIComponent(content);
  } catch {
    return content.replace(/%(?![0-9A-Fa-f]{2})/g, "%25");
  }
}
