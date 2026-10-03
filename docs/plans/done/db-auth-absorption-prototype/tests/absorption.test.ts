import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Effect, Exit, Scope } from "effect";
import { createAuthMiddleware } from "../facade/auth";
import {
  createDatabaseDriver,
  runMigrations,
  type Migration,
} from "../facade/db";
import {
  getDatabaseUrlSecretName,
  getMigrationStorage,
  pluginMigrationSlug,
  pluginSchemaName,
} from "../facade/slug";
import { initialize } from "../demo-plugin/index";
import { notesContract } from "../demo-plugin/contract";

const PROTOTYPE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

function loadPluginMigrations(): Migration[] {
  return readdirSync(join(PROTOTYPE_DIR, "demo-plugin", "migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({
      journal: name.replace(/\.sql$/, ""),
      sql: readFileSync(join(PROTOTYPE_DIR, "demo-plugin", "migrations", name), "utf-8"),
    }));
}

describe("slug semantics (D1)", () => {
  it("derives the canonical plugin_<slug> schema name", () => {
    expect(pluginSchemaName("demo-plugin")).toBe("plugin_demo");
    expect(pluginSchemaName("@scope/notes-plugin")).toBe("plugin_notes");
    expect(pluginSchemaName("api")).toBe("plugin_api");
    expect(pluginMigrationSlug("votes")).toBe("votes");
  });

  it("derives secret names and journal storage from the same slug", () => {
    expect(getDatabaseUrlSecretName(pluginMigrationSlug("demo-plugin"))).toBe(
      "DEMO_DATABASE_URL",
    );
    expect(getMigrationStorage(pluginMigrationSlug("demo-plugin"))).toEqual({
      schema: "drizzle",
      table: "__drizzle_migrations",
      slug: "demo",
    });
  });
});

describe("demo plugin initialize (R channel + schema isolation)", () => {
  it("runs against a loader-provided lifecycle scope — no PluginIdTag anywhere", async () => {
    const scope = Scope.makeUnsafe();
    const deps = await Effect.runPromise(
      Effect.provideService(
        initialize({ pluginId: "demo-plugin", variables: {}, secrets: {} }),
        Scope.Scope,
        scope,
      ),
    );
    const note = await deps.notes.createNote("hello absorption");
    expect(note.id).toBeTruthy();
    const rows = await deps.notes.listNotes(24);
    expect(rows.map((row) => row.body)).toContain("hello absorption");
    await Effect.runPromise(Scope.close(scope, Exit.void));
  });

  it("isolates tables in the plugin_demo schema with a journal row", async () => {
    const driver = await createDatabaseDriver("pglite://:memory:", pluginSchemaName("demo-plugin"));
    const report = await runMigrations(driver, loadPluginMigrations());
    expect(report.applied).toEqual(["0000_init"]);
    const schemas = await driver.client.query(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'plugin_demo'",
    );
    expect(schemas.rows).toHaveLength(1);
    const journal = await driver.client.query(
      "SELECT hash FROM plugin_demo.__drizzle_migrations",
    );
    expect(journal.rows.map((row) => row.hash)).toEqual(["0000_init"]);
    await driver.client.close?.();
  });

  it("re-running migrations is idempotent", async () => {
    const driver = await createDatabaseDriver("pglite://:memory:", pluginSchemaName("demo-plugin"));
    await runMigrations(driver, loadPluginMigrations());
    const second = await runMigrations(driver, loadPluginMigrations());
    expect(second).toEqual({ applied: [], skipped: ["0000_init"] });
    await driver.client.close?.();
  });

  it("supports schema-less mode for dedicated databases (auth-style)", async () => {
    const driver = await createDatabaseDriver("pglite://:memory:");
    expect(driver.schemaName).toBeUndefined();
    const report = await runMigrations(driver, loadPluginMigrations());
    expect(report.applied).toEqual(["0000_init"]);
    const journal = await driver.client.query(
      "SELECT hash FROM public.__drizzle_migrations",
    );
    expect(journal.rows).toHaveLength(1);
    await driver.client.close?.();
  });
});

describe("auth middleware facade", () => {
  interface DemoAuthContext {
    userId?: string;
    user?: { id: string; name: string };
    apiKey?: { id: string };
  }

  function makeBuilder() {
    const middlewares: Array<(input: any) => Promise<unknown>> = [];
    return {
      middleware(fn: (input: any) => Promise<unknown>) {
        middlewares.push(fn);
        return fn;
      },
      run(index: number, context: DemoAuthContext) {
        return middlewares[index]({
          context,
          next: (patch: { context: Partial<DemoAuthContext> }) => ({
            context: { ...context, ...patch.context },
          }),
        });
      },
    };
  }

  it("requireAuth rejects without a user", async () => {
    const builder = makeBuilder();
    const { requireAuth } = createAuthMiddleware<DemoAuthContext>(builder);
    await expect(builder.run(0, {})).rejects.toThrow("Authentication required");
  });

  it("requireAuth narrows the context to an authenticated user", async () => {
    const builder = makeBuilder();
    const { requireAuth } = createAuthMiddleware<DemoAuthContext>(builder);
    const result = (await builder.run(0, {
      userId: "u1",
      user: { id: "u1", name: "Ada" },
    })) as { context: { userId: string; user: { id: string; name: string } } };
    expect(result.context.userId).toBe("u1");
    expect(result.context.user.name).toBe("Ada");
  });

  it("requireAuthOrApiKey passes with only an API key", async () => {
    const builder = makeBuilder();
    const { requireAuthOrApiKey } = createAuthMiddleware<DemoAuthContext>(builder);
    const result = (await builder.run(1, { apiKey: { id: "k1" } })) as {
      context: { apiKey?: { id: string } };
    };
    expect(result.context.apiKey?.id).toBe("k1");
  });
});

describe("fresh plugin file list", () => {
  it("is contract + service + index + migrations", () => {
    const files = readdirSync(join(PROTOTYPE_DIR, "demo-plugin"));
    expect(files.sort()).toEqual(["contract.ts", "index.ts", "migrations", "service.ts"]);
  });

  it("exposes a typed contract shape", () => {
    expect(notesContract.createNote.input).toBeDefined();
    expect(notesContract.listNotes.output).toBeDefined();
  });
});
