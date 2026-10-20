import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkDbTopology,
  detectDbTopology,
  readDbTopology,
} from "../../../src/services/scaffold/upgrade-audit/checks/db-topology";
import { patchDbTopology } from "../../../src/services/scaffold/upgrade-audit/steps/patch-db-topology";

// The sync-owned template form — what `bos sync` writes and what ships in
// everything-dev rc.12: every workspace, the api included, gets plugin_<slug>.
const TEMPLATE_LAYER = [
  'import { Context, Effect, Layer } from "effect";',
  'import { PluginIdTag } from "every-plugin";',
  'import { getMigrationStorage, pluginMigrationSlug } from "everything-dev/db";',
  'import { createDatabaseDriver, type Database, DatabaseError } from "./index";',
  'import { detectDrift, loadMigrations, migrate } from "./migrate";',
  "",
  'export class DatabaseTag extends Context.Service<DatabaseTag, Database>()("Database") {}',
  "",
  "export const DatabaseLive = (url: string) =>",
  "  Layer.effect(",
  "    DatabaseTag,",
  "    Effect.gen(function* () {",
  "      const pluginId = yield* PluginIdTag;",
  "      const slug = pluginMigrationSlug(pluginId);",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal source text of the layer template / patch
  "      const schemaName = `plugin_${slug}`;",
  "",
  "      const driver = yield* Effect.acquireRelease(",
  "        Effect.tryPromise({",
  "          try: () => createDatabaseDriver(url, schemaName),",
  '          catch: (cause) => new DatabaseError({ stage: "driver", cause }),',
  "        }),",
  "      );",
  "",
  "      const storage = getMigrationStorage(slug);",
  "      const { migrations, source } = yield* loadMigrations;",
  "",
  "      const applied = yield* migrate(driver.db, migrations, storage, schemaName);",
  "      yield* Effect.logInfo(",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal source text of the layer template / patch
  "        `[Database] Applied ${applied}/${migrations.length} migration(s) (source: ${source}, journal: ${storage.schema}.${storage.table}, schema: ${schemaName})`,",
  "      );",
  "",
  "      const drift = yield* detectDrift(driver.db, migrations, storage, schemaName);",
  "      return driver.db;",
  "    }),",
  "  );",
  "",
].join("\n");

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "v2-upgrade-db-topology-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

const writeLayer = async (source: string) => {
  await mkdir(join(projectDir, "api/src/db"), { recursive: true });
  await writeFile(join(projectDir, "api/src/db/layer.ts"), source);
};

const readLayer = () => readFile(join(projectDir, "api/src/db/layer.ts"), "utf-8");

const run = async (dryRun: boolean) => Effect.runPromise(patchDbTopology(projectDir, dryRun));

describe("detectDbTopology", () => {
  it("classifies the sync-owned template as plugin-namespaced", () => {
    expect(detectDbTopology(TEMPLATE_LAYER)).toBe("plugin-namespaced");
  });

  it("classifies the api=public special case", () => {
    expect(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal source text of the layer template / patch
      detectDbTopology('const schemaName = slug === "api" ? undefined : `plugin_${slug}`;'),
    ).toBe("public-topology");
  });

  it("classifies unrecognized derivations as unknown", () => {
    expect(detectDbTopology("const schemaName = pluginSchemaName(pluginId);")).toBe("unknown");
  });
});

describe("checkDbTopology", () => {
  it("warns with the drift-manual consequence on the template form", async () => {
    await writeLayer(TEMPLATE_LAYER);
    const findings = await Effect.runPromise(checkDbTopology(projectDir));
    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe("db-topology");
    expect(findings[0].severity).toBe("warn");
    expect(findings[0].message).toMatch(/drift-manual/);
    expect(findings[0].message).toMatch(/pnpm db-topology/);
  });

  it("stays quiet once the api=public fix is in", async () => {
    await writeLayer(TEMPLATE_LAYER);
    await run(false);
    const findings = await Effect.runPromise(checkDbTopology(projectDir));
    expect(findings).toEqual([]);
  });
});

describe("patchDbTopology", () => {
  it("patches the template onto the public-schema topology", async () => {
    await writeLayer(TEMPLATE_LAYER);
    const result = await run(false);
    expect(result.writes).toEqual(["api/src/db/layer.ts"]);

    const after = await readLayer();
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal source text of the layer template / patch
    expect(after).toContain('const schemaName = slug === "api" ? undefined : `plugin_${slug}`;');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal source text of the layer template / patch
    expect(after).toContain('schema: ${schemaName ?? "public"}');
    expect(await Effect.runPromise(readDbTopology(projectDir))).toBe("public-topology");
  });

  it("does not write on dry-run", async () => {
    await writeLayer(TEMPLATE_LAYER);
    const before = await readLayer();
    const result = await run(true);
    expect(result.writes).toEqual(["api/src/db/layer.ts"]);
    expect(await readLayer()).toBe(before);
  });

  it("is idempotent", async () => {
    await writeLayer(TEMPLATE_LAYER);
    await run(false);
    const result = await run(false);
    expect(result.writes).toEqual([]);
    expect(result.notes.join("\n")).toMatch(/already keeps the api on public-schema topology/);
  });

  it("leaves unrecognized derivations alone", async () => {
    const custom = TEMPLATE_LAYER.replace(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal source text of the layer template / patch
      "const schemaName = `plugin_${slug}`;",
      "const schemaName = pluginSchemaName(pluginId);",
    );
    await writeLayer(custom);
    const result = await run(false);
    expect(result.writes).toEqual([]);
    expect(result.notes.join("\n")).toMatch(/not recognized/);
    expect(await readLayer()).toBe(custom);
  });
});
