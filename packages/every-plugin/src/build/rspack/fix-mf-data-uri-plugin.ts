import type { Compiler, RspackPluginInstance } from "@rspack/core";

const MF_DATA_URI_MARKER = "data:text/javascript,";

export class FixMfDataUriPlugin implements RspackPluginInstance {
  name = "FixMfDataUriPlugin";

  apply(compiler: Compiler) {
    compiler.hooks.compilation.tap(this.name, (_compilation, { normalModuleFactory }) => {
      normalModuleFactory.hooks.beforeResolve.tap(this.name, (resolveData) => {
        if (!resolveData?.request) return;
        if (!resolveData.request.includes(MF_DATA_URI_MARKER)) return;
        this.reencodeDataUri(resolveData);
      });
    });
  }

  private reencodeDataUri(resolveData: { request: string }) {
    const { request } = resolveData;
    const idx = request.indexOf(MF_DATA_URI_MARKER);
    if (idx === -1) return;

    const contentStart = idx + MF_DATA_URI_MARKER.length;
    const prefix = request.substring(0, contentStart);
    const rawContent = request.substring(contentStart);

    // The MF runtime's generated data-URI module imports its runtime pieces
    // by absolute node_modules paths (`require.resolve` output), which differ
    // per machine. Rewriting them to bare specifiers keeps the module — and
    // therefore the module id space — machine-independent; the composition
    // aliases the specifiers to their on-disk targets for resolution.
    const decoded = safeDecode(rawContent).replace(/(["'])\/[^"']*?\/node_modules\//g, "$1");
    resolveData.request = prefix + encodeURIComponent(decoded);
  }
}

function safeDecode(content: string): string {
  try {
    return decodeURIComponent(content);
  } catch {
    return content.replace(/%(?![0-9A-Fa-f]{2})/g, "%25");
  }
}
