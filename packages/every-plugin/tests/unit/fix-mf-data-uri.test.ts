import { describe, expect, it } from "vitest";
import { rewriteMfDataUriRequest } from "../../src/build/rspack/fix-mf-data-uri-plugin";

const dataUri = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
const decode = (request: string) =>
  decodeURIComponent(request.slice("data:text/javascript,".length));

describe("rewriteMfDataUriRequest", () => {
  it("strips the machine-absolute prefix from MF runtime imports", () => {
    const request = dataUri(
      [
        `import * as runtime from "/Users/a/proj/node_modules/.pnpm/x/node_modules/@module-federation/webpack-bundler-runtime/dist/index.js";`,
        `import plugin from '/home/b/node_modules/@module-federation/node/dist/src/runtimePlugin.js';`,
      ].join("\n"),
    );
    const out = decode(rewriteMfDataUriRequest(request));
    expect(out).toContain(`"@module-federation/webpack-bundler-runtime/dist/index.js"`);
    expect(out).toContain(`'@module-federation/node/dist/src/runtimePlugin.js'`);
    expect(out).not.toContain("/node_modules/");
  });

  it("leaves non-MF absolute imports alone so unexported subpaths still resolve", () => {
    const hmr = "/Users/a/proj/node_modules/@rsbuild/core/dist/client/hmr.js";
    const overlay = "/Users/a/proj/node_modules/@rsbuild/core/dist/client/overlay.js";
    const request = dataUri(
      `import { init } from '${hmr}';\nimport '${overlay}';\ninit('t', {}, "localhost", 3003);`,
    );
    const out = decode(rewriteMfDataUriRequest(request));
    expect(out).toContain(`'${hmr}'`);
    expect(out).toContain(`'${overlay}'`);
  });

  it("passes through requests that are not data URIs", () => {
    expect(rewriteMfDataUriRequest("./src/index.ts")).toBe("./src/index.ts");
  });
});
