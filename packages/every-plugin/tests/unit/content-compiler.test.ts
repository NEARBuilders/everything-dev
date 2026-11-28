import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPluginBaseConfig } from "../../src/build/rspack/compose";
import { ContentCompilerPlugin } from "../../src/build/rspack/content";

// The scratch workspace must live under the repo: the fixture's velite
// config imports "velite" (the workspace's own devDependency, hoisted to the
// root node_modules) and resolution climbs through the directory ancestors.
const scratchRoot = join(import.meta.dirname, ".scratch");

afterEach(() => {
  rmSync(scratchRoot, { recursive: true, force: true });
});

let workspaceCounter = 0;

function makeContentWorkspace(): string {
  workspaceCounter += 1;
  const cwd = join(scratchRoot, `workspace-${workspaceCounter}`);
  mkdirSync(join(cwd, "docs"), { recursive: true });
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({ name: "@test/content-plugin", version: "0.0.0" }),
  );
  writeFileSync(
    join(cwd, "velite.config.ts"),
    `import { context, defineCollection, defineConfig, s, z } from "velite";

export default defineConfig({
  root: ".",
  output: { data: ".velite", clean: false },
  collections: {
    docs: defineCollection({
      name: "Doc",
      pattern: ["docs/**/*.md"],
      schema: s.object({
        slug: s.custom<string>().transform(() =>
          context().file.path.replace(/\\\\/g, "/").split("/").at(-1)!.replace(/\\.md$/, ""),
        ),
        raw: s.custom<string>().transform(() => context().file.content),
        title: z.string().optional(),
      }),
    }),
  },
});
`,
  );
  writeFileSync(join(cwd, "docs", "hello.md"), "# Hello world\n\nContent body.\n");
  return cwd;
}

const pluginNames = (config: { plugins: unknown[] }) =>
  config.plugins.map((plugin) => (plugin as { name?: string }).name);

describe("createPluginBaseConfig content auto-wiring", () => {
  it("appends the ContentCompilerPlugin when the workspace declares velite.config.ts", () => {
    const cwd = makeContentWorkspace();
    const config = createPluginBaseConfig({ cwd });
    expect(pluginNames(config)).toContain("ContentCompilerPlugin");
  });

  it("does not wire the content compiler without a velite.config.ts", () => {
    const cwd = makeContentWorkspace();
    rmSync(join(cwd, "velite.config.ts"));
    const config = createPluginBaseConfig({ cwd });
    expect(pluginNames(config)).not.toContain("ContentCompilerPlugin");
  });

  it("content: false opts out for hand-wired extraPlugins", () => {
    const cwd = makeContentWorkspace();
    const config = createPluginBaseConfig({ cwd, content: false });
    expect(pluginNames(config)).not.toContain("ContentCompilerPlugin");
  });
});

interface CapturedHooks {
  beforeCompile: (() => Promise<unknown>) | null;
  onCompilation: ((compilation: unknown) => void) | null;
  processAssets: (() => Promise<unknown>) | null;
  emitted: Record<string, string>;
}

function makeStubCompiler(cwd: string): { compiler: unknown; hooks: CapturedHooks } {
  const hooks: CapturedHooks = {
    beforeCompile: null,
    onCompilation: null,
    processAssets: null,
    emitted: {},
  };
  const compiler = {
    options: { watch: false, context: cwd },
    hooks: {
      beforeCompile: {
        tapPromise: (_name: string, fn: () => Promise<unknown>) => {
          hooks.beforeCompile = fn;
        },
      },
      thisCompilation: {
        tap: (_name: string, fn: (compilation: unknown) => void) => {
          hooks.onCompilation = fn;
        },
      },
    },
    webpack: {
      sources: {
        RawSource: class {
          source: unknown;
          constructor(source: unknown) {
            this.source = source;
          }
        },
      },
      Compilation: { PROCESS_ASSETS_STAGE_ADDITIONS: 100 },
    },
  };
  return { compiler, hooks };
}

describe("ContentCompilerPlugin", () => {
  it("compiles the collections and emits them as content artifacts", async () => {
    const cwd = makeContentWorkspace();
    const { compiler, hooks } = makeStubCompiler(cwd);

    new ContentCompilerPlugin({ cwd }).apply(compiler as never);
    expect(hooks.onCompilation).toBeTypeOf("function");

    const emitted: Record<string, string> = {};
    hooks.onCompilation!({
      hooks: {
        processAssets: {
          tapPromise: (_opts: unknown, fn: () => Promise<unknown>) => {
            hooks.processAssets = fn;
          },
        },
      },
      emitAsset: (name: string, source: { source: unknown }) => {
        emitted[name] = String(source.source);
      },
    });

    await hooks.beforeCompile!();
    expect(existsSync(join(cwd, ".velite", "index.js"))).toBe(true);

    await hooks.processAssets!();
    const emittedJson = emitted["content/docs.json"];
    expect(emittedJson).toBeDefined();
    expect(emittedJson).toContain("Hello world");
    expect(JSON.parse(emittedJson!)).toHaveLength(1);
  }, 30_000);

  it("does nothing for a workspace without a velite.config.ts", async () => {
    const cwd = join(scratchRoot, "empty");
    mkdirSync(cwd, { recursive: true });
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({ name: "@test/plain", version: "0.0.0" }),
    );
    const { compiler, hooks } = makeStubCompiler(cwd);

    new ContentCompilerPlugin({ cwd }).apply(compiler as never);
    expect(hooks.beforeCompile).toBeNull();
  });
});

describe("content artifact surface", () => {
  it("reads the velite output JSON from disk at emit time, not a cached build result", async () => {
    const cwd = makeContentWorkspace();
    const { compiler, hooks } = makeStubCompiler(cwd);
    new ContentCompilerPlugin({ cwd }).apply(compiler as never);
    const assets: Record<string, unknown> = {};
    hooks.onCompilation!({
      hooks: {
        processAssets: {
          tapPromise: (_o: unknown, fn: () => Promise<unknown>) => (hooks.processAssets = fn),
        },
      },
      emitAsset: (name: string, source: { source: unknown }) => {
        assets[name] = source.source;
      },
    });

    // The velite output exists before the emit but the emitted bytes are
    // read from disk at emit time — an edit between build and emit is
    // picked up (the contract the watch loop relies on).
    await hooks.beforeCompile!();
    const fresh = readFileSync(join(cwd, ".velite", "docs.json"), "utf8");
    writeFileSync(join(cwd, ".velite", "docs.json"), fresh.replace("Hello world", "Hello edited"));
    await hooks.processAssets!();
    expect(String(assets["content/docs.json"])).toContain("Hello edited");
  }, 30_000);
});
