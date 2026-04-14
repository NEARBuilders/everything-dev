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

    if (isAlreadyEncoded(rawContent)) return;

    const decoded = safeDecode(rawContent);
    resolveData.request = prefix + encodeURIComponent(decoded);
  }
}

function isAlreadyEncoded(content: string): boolean {
  try {
    const decoded = decodeURIComponent(content);
    return decoded !== content;
  } catch {
    return false;
  }
}

function safeDecode(content: string): string {
  try {
    return decodeURIComponent(content);
  } catch {
    return content.replace(/%(?![0-9A-Fa-f]{2})/g, "%25");
  }
}
