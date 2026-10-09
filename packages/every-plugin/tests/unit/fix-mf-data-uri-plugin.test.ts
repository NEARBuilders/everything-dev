import { describe, expect, it } from "vitest";
import { FixMfDataUriPlugin } from "../../src/build/rspack/fix-mf-data-uri-plugin";

class FakeHook {
  private taps: Array<(...args: any[]) => unknown> = [];
  tap(_name: string, fn: (...args: any[]) => unknown) {
    this.taps.push(fn);
  }
  call(...args: any[]) {
    for (const fn of this.taps) fn(...args);
  }
}

function makeCompiler() {
  const normalModuleFactory = {
    hooks: {
      beforeResolve: new FakeHook(),
      resolve: new FakeHook(),
    },
  };
  const compilationHook = new FakeHook();
  const plugin = new FixMfDataUriPlugin();
  plugin.apply({
    hooks: {
      compilation: compilationHook,
    },
  } as any);
  compilationHook.call({}, { normalModuleFactory });
  return { normalModuleFactory, plugin };
}

const dataUri = (content: string) => `data:text/javascript,${encodeURIComponent(content)}`;

describe("FixMfDataUriPlugin", () => {
  it("rewrites absolute node_modules imports in data-URI modules to bare specifiers", () => {
    const { normalModuleFactory } = makeCompiler();
    const resolveData = {
      request: dataUri(
        `import x from "/repo/node_modules/@module-federation/webpack-bundler-runtime/dist/index.cjs";`,
      ),
    };
    normalModuleFactory.hooks.beforeResolve.call(resolveData);
    expect(resolveData.request).toBe(
      dataUri(`import x from "@module-federation/webpack-bundler-runtime/dist/index.cjs";`),
    );
  });

  it("handles single-quoted imports (rsbuild HMR entry style)", () => {
    const { normalModuleFactory } = makeCompiler();
    const resolveData = {
      request: dataUri(
        `import { init } from '/repo/node_modules/@rsbuild/core/dist/client/hmr.js';`,
      ),
    };
    normalModuleFactory.hooks.beforeResolve.call(resolveData);
    expect(resolveData.request).toBe(
      dataUri(`import { init } from '@rsbuild/core/dist/client/hmr.js';`),
    );
  });

  it("redirects recorded bare specifiers back to their original absolute paths", () => {
    const { normalModuleFactory } = makeCompiler();
    const absolute = "/repo/node_modules/@rsbuild/core/dist/client/hmr.js";
    normalModuleFactory.hooks.beforeResolve.call({
      request: dataUri(`import { init } from '${absolute}';`),
    });

    const redirected = { request: "@rsbuild/core/dist/client/hmr.js" };
    normalModuleFactory.hooks.resolve.call(redirected);
    expect(redirected.request).toBe(absolute);
  });

  it("records mappings for multiple imports in one module", () => {
    const { normalModuleFactory } = makeCompiler();
    normalModuleFactory.hooks.beforeResolve.call({
      request: dataUri(
        `import a from "/repo/node_modules/@module-federation/webpack-bundler-runtime/dist/index.cjs";` +
          `import b from "/repo/node_modules/@module-federation/node/dist/src/runtimePlugin.js";`,
      ),
    });

    const first = { request: "@module-federation/webpack-bundler-runtime/dist/index.cjs" };
    normalModuleFactory.hooks.resolve.call(first);
    expect(first.request).toBe(
      "/repo/node_modules/@module-federation/webpack-bundler-runtime/dist/index.cjs",
    );

    const second = { request: "@module-federation/node/dist/src/runtimePlugin.js" };
    normalModuleFactory.hooks.resolve.call(second);
    expect(second.request).toBe(
      "/repo/node_modules/@module-federation/node/dist/src/runtimePlugin.js",
    );
  });

  it("leaves non-data-URI and unmapped requests untouched", () => {
    const { normalModuleFactory } = makeCompiler();
    const plain = { request: "./src/index.ts" };
    normalModuleFactory.hooks.beforeResolve.call(plain);
    expect(plain.request).toBe("./src/index.ts");

    const unmapped = { request: "@module-federation/other/dist/index.js" };
    normalModuleFactory.hooks.resolve.call(unmapped);
    expect(unmapped.request).toBe("@module-federation/other/dist/index.js");
  });

  it("is idempotent — already-normalized data-URIs pass through unchanged", () => {
    const { normalModuleFactory } = makeCompiler();
    const normalized = dataUri(
      `import x from "@module-federation/webpack-bundler-runtime/dist/index.cjs";`,
    );
    const resolveData = { request: normalized };
    normalModuleFactory.hooks.beforeResolve.call(resolveData);
    expect(resolveData.request).toBe(normalized);
  });
});
