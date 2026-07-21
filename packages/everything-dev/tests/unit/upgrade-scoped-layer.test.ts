import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rewriteLegacyPluginScopedLayerPatterns } from "../../src/cli/upgrade";

describe("rewriteLegacyPluginScopedLayerPatterns", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeProjectDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "upgrade-scoped-layer-"));
    tempDirs.push(dir);
    return dir;
  }

  function writeFile(dir: string, relPath: string, content: string): void {
    const full = join(dir, relPath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }

  it("rewrites yield* Effect.provide(Tag, Layer) two-arg form in api/src/index.ts", async () => {
    const dir = makeProjectDir();
    writeFile(
      dir,
      "api/src/index.ts",
      [
        'import { Effect } from "every-plugin/effect";',
        'import { DatabaseLive, DatabaseTag } from "./db/layer";',
        "",
        "export default createPlugin({",
        "  initialize: (config, plugins) =>",
        "    Effect.gen(function* () {",
        "      const db = yield* Effect.provide(DatabaseTag, DatabaseLive(config.secrets.API_DATABASE_URL));",
        "      return { db };",
        "    }),",
        "  createRouter: () => ({}),",
        "});",
        "",
      ].join("\n"),
    );

    const migrated = await rewriteLegacyPluginScopedLayerPatterns(dir);
    expect(migrated).toContain("api/src/index.ts");

    const result = readFileSync(join(dir, "api/src/index.ts"), "utf-8");
    expect(result).toContain(
      "yield* tools.buildService(DatabaseTag, DatabaseLive(config.secrets.API_DATABASE_URL))",
    );
    expect(result).not.toContain("Effect.provide(DatabaseTag");
    expect(result).toContain("initialize: (config, plugins, tools) =>");
  });

  it("rewrites yield* Effect.provide(Tag, Layer) two-arg form in plugins/*/src/index.ts", async () => {
    const dir = makeProjectDir();
    writeFile(
      dir,
      "plugins/widgets/src/index.ts",
      [
        'import { Effect } from "every-plugin/effect";',
        'import { WidgetsLive, WidgetsTag } from "./widgets";',
        "",
        "export default createPlugin({",
        "  initialize: (config) =>",
        "    Effect.gen(function* () {",
        "      const widgets = yield* Effect.provide(WidgetsTag, WidgetsLive(config.secrets.URL));",
        "      return { widgets };",
        "    }),",
        "  createRouter: () => ({}),",
        "});",
        "",
      ].join("\n"),
    );

    const migrated = await rewriteLegacyPluginScopedLayerPatterns(dir);
    expect(migrated).toContain("plugins/widgets/src/index.ts");

    const result = readFileSync(join(dir, "plugins/widgets/src/index.ts"), "utf-8");
    expect(result).toContain(
      "yield* tools.buildService(WidgetsTag, WidgetsLive(config.secrets.URL))",
    );
    expect(result).toContain("initialize: (config, _plugins, tools) =>");
  });

  it("rewrites .pipe(Effect.provide(Layer)) form in api/src/index.ts to tools.buildService", async () => {
    const dir = makeProjectDir();
    writeFile(
      dir,
      "api/src/index.ts",
      [
        'import { createPlugin } from "every-plugin";',
        'import { Effect } from "every-plugin/effect";',
        'import { DatabaseLive, DatabaseTag } from "./db/layer";',
        "",
        "export default createPlugin({",
        "  initialize: (config, plugins) =>",
        "    Effect.gen(function* () {",
        "      const db = yield* DatabaseTag;",
        "      const { auth, ...restPlugins } = plugins;",
        '      console.log("[API] Services Initialized");',
        "      return { auth, plugins: restPlugins, db };",
        "    }).pipe(Effect.provide(DatabaseLive(config.secrets.API_DATABASE_URL))),",
        "  shutdown: () => Effect.log('[API] Shutdown'),",
        "  createRouter: () => ({}),",
        "});",
        "",
      ].join("\n"),
    );

    const migrated = await rewriteLegacyPluginScopedLayerPatterns(dir);
    expect(migrated).toContain("api/src/index.ts");

    const result = readFileSync(join(dir, "api/src/index.ts"), "utf-8");
    expect(result).toContain(
      "const db = yield* tools.buildService(DatabaseTag, DatabaseLive(config.secrets.API_DATABASE_URL));",
    );
    expect(result).not.toContain(".pipe(Effect.provide(");
    expect(result).toContain("initialize: (config, plugins, tools) =>");
    expect(result).toContain("    }),");
    expect(result).toContain("shutdown: () => Effect.log('[API] Shutdown'),");
  });

  it("rewrites .pipe(Effect.provide(Layer)) form in plugins/*/src/index.ts", async () => {
    const dir = makeProjectDir();
    writeFile(
      dir,
      "plugins/widgets/src/index.ts",
      [
        'import { Effect } from "every-plugin/effect";',
        'import { WidgetsLive, WidgetsTag } from "./widgets";',
        "",
        "export default createPlugin({",
        "  initialize: (config) =>",
        "    Effect.gen(function* () {",
        "      const widgets = yield* WidgetsTag;",
        "      return { widgets };",
        "    }).pipe(Effect.provide(WidgetsLive(config.secrets.URL))),",
        "  createRouter: () => ({}),",
        "});",
        "",
      ].join("\n"),
    );

    const migrated = await rewriteLegacyPluginScopedLayerPatterns(dir);
    expect(migrated).toContain("plugins/widgets/src/index.ts");

    const result = readFileSync(join(dir, "plugins/widgets/src/index.ts"), "utf-8");
    expect(result).toContain(
      "const widgets = yield* tools.buildService(WidgetsTag, WidgetsLive(config.secrets.URL));",
    );
    expect(result).not.toContain(".pipe(Effect.provide(");
    expect(result).toContain("initialize: (config, _plugins, tools) =>");
  });

  it("rewrites multiline .pipe(\\n  Effect.provide(Layer),\\n) form", async () => {
    const dir = makeProjectDir();
    writeFile(
      dir,
      "api/src/index.ts",
      [
        'import { Effect } from "every-plugin/effect";',
        'import { DatabaseLive, DatabaseTag } from "./db/layer";',
        "",
        "export default createPlugin({",
        "  initialize: (config, plugins) =>",
        "    Effect.gen(function* () {",
        "      const db = yield* DatabaseTag;",
        "      return { db };",
        "    }).pipe(",
        "      Effect.provide(DatabaseLive(config.secrets.API_DATABASE_URL)),",
        "    ),",
        "  createRouter: () => ({}),",
        "});",
        "",
      ].join("\n"),
    );

    const migrated = await rewriteLegacyPluginScopedLayerPatterns(dir);
    expect(migrated).toContain("api/src/index.ts");

    const result = readFileSync(join(dir, "api/src/index.ts"), "utf-8");
    expect(result).toContain(
      "const db = yield* tools.buildService(DatabaseTag, DatabaseLive(config.secrets.API_DATABASE_URL));",
    );
    expect(result).not.toContain("Effect.provide(");
    expect(result).toContain("initialize: (config, plugins, tools) =>");
  });

  it("skips .pipe(Effect.provide(...)) when the layer name does not match a Tag convention", async () => {
    const dir = makeProjectDir();
    const original = [
      'import { Effect } from "every-plugin/effect";',
      'import { Layer } from "every-plugin/effect";',
      "",
      "export default createPlugin({",
      "  initialize: (config, plugins) =>",
      "    Effect.gen(function* () {",
      "      const db = yield* DatabaseTag;",
      "      return { db };",
      "    }).pipe(Effect.provide(Layer.provide(DatabaseTag, makeDb(config.secrets.URL)))),",
      "  createRouter: () => ({}),",
      "});",
      "",
    ].join("\n");
    writeFile(dir, "api/src/index.ts", original);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await rewriteLegacyPluginScopedLayerPatterns(dir);

    const result = readFileSync(join(dir, "api/src/index.ts"), "utf-8");
    expect(result).toContain(".pipe(Effect.provide(");
    expect(result).not.toContain("tools.buildService");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("skips .pipe(Effect.provide(...)) when multiple bare yield* <Tag> are present", async () => {
    const dir = makeProjectDir();
    writeFile(
      dir,
      "api/src/index.ts",
      [
        'import { Effect } from "every-plugin/effect";',
        'import { DatabaseLive, DatabaseTag } from "./db/layer";',
        "",
        "export default createPlugin({",
        "  initialize: (config, plugins) =>",
        "    Effect.gen(function* () {",
        "      const a = yield* DatabaseTag;",
        "      const b = yield* DatabaseTag;",
        "      return { a, b };",
        "    }).pipe(Effect.provide(DatabaseLive(config.secrets.API_DATABASE_URL))),",
        "  createRouter: () => ({}),",
        "});",
        "",
      ].join("\n"),
    );

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await rewriteLegacyPluginScopedLayerPatterns(dir);

    const result = readFileSync(join(dir, "api/src/index.ts"), "utf-8");
    expect(result).toContain(".pipe(Effect.provide(");
    expect(result).not.toContain("tools.buildService");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("leaves already-migrated files untouched", async () => {
    const dir = makeProjectDir();
    const original = [
      'import { Effect } from "every-plugin/effect";',
      'import { DatabaseLive, DatabaseTag } from "./db/layer";',
      "",
      "export default createPlugin({",
      "  initialize: (config, plugins, tools) =>",
      "    Effect.gen(function* () {",
      "      const db = yield* tools.buildService(DatabaseTag, DatabaseLive(config.secrets.API_DATABASE_URL));",
      "      return { db };",
      "    }),",
      "  createRouter: () => ({}),",
      "});",
      "",
    ].join("\n");
    writeFile(dir, "api/src/index.ts", original);

    const migrated = await rewriteLegacyPluginScopedLayerPatterns(dir);
    expect(migrated).toEqual([]);

    const result = readFileSync(join(dir, "api/src/index.ts"), "utf-8");
    expect(result).toBe(original);
  });

  it("does not double-add tools when initialize already has it (pipe form)", async () => {
    const dir = makeProjectDir();
    writeFile(
      dir,
      "api/src/index.ts",
      [
        'import { Effect } from "every-plugin/effect";',
        'import { DatabaseLive, DatabaseTag } from "./db/layer";',
        "",
        "export default createPlugin({",
        "  initialize: (config, plugins, tools) =>",
        "    Effect.gen(function* () {",
        "      const db = yield* DatabaseTag;",
        "      return { db };",
        "    }).pipe(Effect.provide(DatabaseLive(config.secrets.API_DATABASE_URL))),",
        "  createRouter: () => ({}),",
        "});",
        "",
      ].join("\n"),
    );

    const migrated = await rewriteLegacyPluginScopedLayerPatterns(dir);
    expect(migrated).toContain("api/src/index.ts");

    const result = readFileSync(join(dir, "api/src/index.ts"), "utf-8");
    expect(result).toContain(
      "const db = yield* tools.buildService(DatabaseTag, DatabaseLive(config.secrets.API_DATABASE_URL));",
    );
    expect(result).not.toContain(".pipe(Effect.provide(");
    expect(result).toContain("initialize: (config, plugins, tools) =>");
    expect(result).not.toContain("tools, tools)");
  });

  it("returns empty when no matching files exist", async () => {
    const dir = makeProjectDir();
    const migrated = await rewriteLegacyPluginScopedLayerPatterns(dir);
    expect(migrated).toEqual([]);
  });
});
