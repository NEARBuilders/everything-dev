import type { Compiler, RspackPluginInstance } from "@rspack/core";

const MF_DATA_URI_MARKER = "data:text/javascript,";
const NODE_MODULES_IMPORT_RE = /(["'])\/[^"']*?\/node_modules\/([^"']*)\1/g;

export class FixMfDataUriPlugin implements RspackPluginInstance {
  name = "FixMfDataUriPlugin";

  /** Bare specifier → on-disk absolute path, learned while rewriting. */
  private redirects = new Map<string, string>();

  apply(compiler: Compiler) {
    compiler.hooks.compilation.tap(this.name, (_compilation, { normalModuleFactory }) => {
      normalModuleFactory.hooks.beforeResolve.tap(this.name, (resolveData) => {
        if (!resolveData?.request) return;
        if (!resolveData.request.includes(MF_DATA_URI_MARKER)) return;
        this.reencodeDataUri(resolveData);
      });
      normalModuleFactory.hooks.resolve.tap(this.name, (resolveData) => {
        const target = this.redirects.get(resolveData?.request ?? "");
        if (target) {
          resolveData.request = target;
        }
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

    // The MF runtime's and rsbuild's generated data-URI modules import their
    // runtime pieces by absolute node_modules paths (`require.resolve` output),
    // which differ per machine. Rewriting them to bare specifiers keeps the
    // module — and therefore the module id space — machine-independent; the
    // recorded redirects resolve those specifiers back to this machine's
    // on-disk copies while the request (and thus the module id) stays bare.
    const decoded = safeDecode(rawContent).replace(
      NODE_MODULES_IMPORT_RE,
      (match, _quote: string, rest: string) => {
        this.redirects.set(rest, match.slice(1, -1));
        return _quote + rest + _quote;
      },
    );
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
