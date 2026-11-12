import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  migrateLegacyComposeState,
  rewrittenLegacyDatabaseValues,
  rewrittenSharedPgliteValues,
} from "../../src/env/legacy-databases";

function makeProject(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "everything-dev-legacy-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runMigration(dir: string) {
  return Effect.runSync(migrateLegacyComposeState(dir));
}

const composeScaffold = `services:
  postgres-api:
    image: ghcr.io/nearbuilders/mirror-postgres:17-alpine
    ports:
      - "5432:5432"
  postgres-auth:
    image: ghcr.io/nearbuilders/mirror-postgres:17-alpine
    ports:
      - "5433:5432"
`;

const composeCustom = `services:
  mydb:
    image: postgres:17-alpine
    ports:
      - "6999:5432"
`;

describe("rewrittenLegacyDatabaseValues", () => {
  it("rewrites the conventional dev URLs to the persistent pglite default", () => {
    const rewritten = rewrittenLegacyDatabaseValues({
      file: {
        API_DATABASE_URL: "postgres://everythingdev:everythingdev@localhost:5432/api_db",
        AUTH_DATABASE_URL: "postgres://everythingdev:everythingdev@localhost:5433/auth_db",
      },
      raw:
        "API_DATABASE_URL=postgres://everythingdev:everythingdev@localhost:5432/api_db\n" +
        "AUTH_DATABASE_URL=postgres://everythingdev:everythingdev@localhost:5433/auth_db\n",
    });
    expect(rewritten.get("API_DATABASE_URL")).toBe("pglite:.bos/db/api");
    expect(rewritten.get("AUTH_DATABASE_URL")).toBe("pglite:.bos/db/auth");
  });

  it("drifted convention ports still rewrite by database name", () => {
    const rewritten = rewrittenLegacyDatabaseValues({
      file: { API_DATABASE_URL: "postgres://everythingdev:everythingdev@localhost:5532/api_db" },
      raw: "API_DATABASE_URL=postgres://everythingdev:everythingdev@localhost:5532/api_db\n",
    });
    expect(rewritten.get("API_DATABASE_URL")).toBe("pglite:.bos/db/api");
  });

  it("rewrites the conventional test URLs to in-memory pglite", () => {
    const rewritten = rewrittenLegacyDatabaseValues({
      file: {
        API_DATABASE_URL: "postgres://everythingdev:everythingdev@localhost:5434/api_test_db",
        AUTH_DATABASE_URL: "postgres://everythingdev:everythingdev@localhost:5435/auth_test_db",
      },
      raw:
        "API_DATABASE_URL=postgres://everythingdev:everythingdev@localhost:5434/api_test_db\n" +
        "AUTH_DATABASE_URL=postgres://everythingdev:everythingdev@localhost:5435/auth_test_db\n",
    });
    expect(rewritten.get("API_DATABASE_URL")).toBe("pglite::memory:");
    expect(rewritten.get("AUTH_DATABASE_URL")).toBe("pglite::memory:");
  });

  it("leaves operator-owned postgres URLs alone", () => {
    const custom = "postgres://myuser:mypass@localhost:5432/api_db";
    const remote = "postgres://u:p@ep-neon.example.com/api_db";
    const train = "postgres://rider:pass@127.0.0.1:5432/different_db";
    const rewritten = rewrittenLegacyDatabaseValues({
      file: { API_DATABASE_URL: custom, OTHER_DATABASE_URL: remote, TRAIN: train },
      raw: `API_DATABASE_URL=${custom}\nOTHER_DATABASE_URL=${remote}\nTRAIN=${train}\n`,
    });
    expect(rewritten.size).toBe(0);
  });

  it("ignores non-postgres schemes and pglite URLs", () => {
    const rewritten = rewrittenLegacyDatabaseValues({
      file: { API_DATABASE_URL: "pglite:.bos/db" },
      raw: "API_DATABASE_URL=pglite:.bos/db\n",
    });
    expect(rewritten.size).toBe(0);
  });
});

describe("rewrittenSharedPgliteValues", () => {
  it("splits the shared pre-0044 dir into per-identity subdirs", () => {
    const rewritten = rewrittenSharedPgliteValues({
      API_DATABASE_URL: "pglite:.bos/db",
      AUTH_DATABASE_URL: "pglite:.bos/db",
      AGENT_CONNECT_DATABASE_URL: "pglite:.bos/db",
      CONNECTORS_DATABASE_URL: "pglite:.bos/db",
    });
    expect(rewritten.get("API_DATABASE_URL")).toBe("pglite:.bos/db/api");
    expect(rewritten.get("AUTH_DATABASE_URL")).toBe("pglite:.bos/db/auth");
    expect(rewritten.get("AGENT_CONNECT_DATABASE_URL")).toBe("pglite:.bos/db/agent_connect");
    expect(rewritten.get("CONNECTORS_DATABASE_URL")).toBe("pglite:.bos/db/connectors");
  });

  it("leaves a single pglite pin alone — one occupant cannot corrupt", () => {
    const rewritten = rewrittenSharedPgliteValues({
      API_DATABASE_URL: "pglite:.bos/db",
      AUTH_DATABASE_URL: "postgres://u:p@localhost:5432/auth",
    });
    expect(rewritten.size).toBe(0);
  });

  it("skips a rewrite whose target dir is occupied by a pin that stays", () => {
    const rewritten = rewrittenSharedPgliteValues({
      API_DATABASE_URL: "pglite:.bos/db",
      AGENT_CONNECT_DATABASE_URL: "pglite:.bos/db",
      CONNECTORS_DATABASE_URL: "pglite:.bos/db/api",
    });
    expect(rewritten.has("API_DATABASE_URL")).toBe(false);
    expect(rewritten.get("AGENT_CONNECT_DATABASE_URL")).toBe("pglite:.bos/db/agent_connect");
    expect(rewritten.has("CONNECTORS_DATABASE_URL")).toBe(false);
  });

  it("is idempotent: per-identity dirs produce no rewrite", () => {
    const rewritten = rewrittenSharedPgliteValues({
      API_DATABASE_URL: "pglite:.bos/db/api",
      AUTH_DATABASE_URL: "pglite:.bos/db/auth",
    });
    expect(rewritten.size).toBe(0);
  });

  it("never touches in-memory URLs or operator-authored shared dirs", () => {
    const rewritten = rewrittenSharedPgliteValues({
      API_DATABASE_URL: "pglite::memory:",
      AUTH_DATABASE_URL: "pglite::memory:",
      AGENT_CONNECT_DATABASE_URL: "pglite:.data/shared",
      CONNECTORS_DATABASE_URL: "pglite:.data/shared",
    });
    expect(rewritten.size).toBe(0);
  });
});

describe("migrateLegacyComposeState", () => {
  it("rewrites .env lines and relocates the scaffold compose file", () => {
    const { dir, cleanup } = makeProject();
    try {
      writeFileSync(
        join(dir, ".env"),
        "API_DATABASE_URL=postgres://everythingdev:everythingdev@localhost:5432/api_db\n" +
          "CUSTOM_DATABASE_URL=postgres://myuser:mypass@localhost:5432/custom\n",
      );
      writeFileSync(join(dir, "docker-compose.yml"), composeScaffold);

      const result = runMigration(dir);

      expect(result.composeRelocated).toBe(true);
      expect(result.databaseUrlDrift).toEqual([
        {
          key: "API_DATABASE_URL",
          from: "postgres://everythingdev:everythingdev@localhost:5432/api_db",
          to: "pglite:.bos/db/api",
        },
      ]);

      const env = readFileSync(join(dir, ".env"), "utf-8");
      expect(env).toContain("API_DATABASE_URL=pglite:.bos/db/api");
      expect(env).toContain("CUSTOM_DATABASE_URL=postgres://myuser:mypass@localhost:5432/custom");
      expect(
        readFileSync(join(dir, ".bos", "compose-retired", "docker-compose.yml"), "utf-8"),
      ).toBe(composeScaffold);
    } finally {
      cleanup();
    }
  });

  it("is idempotent: a second run is a no-op", () => {
    const { dir, cleanup } = makeProject();
    try {
      writeFileSync(join(dir, ".env"), "API_DATABASE_URL=pglite:.bos/db\n");
      writeFileSync(join(dir, "docker-compose.yml"), composeScaffold);

      const first = runMigration(dir);
      expect(first.composeRelocated).toBe(true);
      const second = runMigration(dir);
      expect(second.composeRelocated).toBe(false);
      expect(second.databaseUrlDrift).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("repairs the shared pre-0044 pglite dir once and reports the drift", () => {
    const { dir, cleanup } = makeProject();
    try {
      writeFileSync(
        join(dir, ".env"),
        "API_DATABASE_URL=pglite:.bos/db\n" +
          "AUTH_DATABASE_URL=pglite:.bos/db\n" +
          "AGENT_CONNECT_DATABASE_URL=pglite:.bos/db\n",
      );

      const first = runMigration(dir);
      expect(first.databaseUrlDrift).toEqual([
        { key: "API_DATABASE_URL", from: "pglite:.bos/db", to: "pglite:.bos/db/api" },
        { key: "AUTH_DATABASE_URL", from: "pglite:.bos/db", to: "pglite:.bos/db/auth" },
        {
          key: "AGENT_CONNECT_DATABASE_URL",
          from: "pglite:.bos/db",
          to: "pglite:.bos/db/agent_connect",
        },
      ]);
      const env = readFileSync(join(dir, ".env"), "utf-8");
      expect(env).toContain("API_DATABASE_URL=pglite:.bos/db/api");
      expect(env).toContain("AUTH_DATABASE_URL=pglite:.bos/db/auth");
      expect(env).toContain("AGENT_CONNECT_DATABASE_URL=pglite:.bos/db/agent_connect");

      const second = runMigration(dir);
      expect(second.databaseUrlDrift).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("does not relocate an operator-authored compose file", () => {
    const { dir, cleanup } = makeProject();
    try {
      writeFileSync(join(dir, "docker-compose.yml"), composeCustom);
      const result = runMigration(dir);
      expect(result.composeRelocated).toBe(false);
      expect(readFileSync(join(dir, "docker-compose.yml"), "utf-8")).toBe(composeCustom);
    } finally {
      cleanup();
    }
  });
});
