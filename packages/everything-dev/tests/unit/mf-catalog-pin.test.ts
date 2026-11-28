import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse, parseAllDocuments } from "yaml";

// #933: the host image is built from the parent lockfile, whose
// @module-federation/* resolutions are what the smoke `bos mf check` gate
// compares every plugin bundle against (pluginVersion must equal the host's
// exactly). A caret catalog row makes every child that re-resolves its
// lockfile float to the newest patch — its bundles then report a newer
// pluginVersion than the image and the deploy smoke fails with "redeploy
// this plugin", which can never succeed. These rows must stay exact so
// children resolve the same versions the image was built from. Exactness is
// also the gate's own requirement: the truth gate and mf-compat checks
// compare versions for equality, not range satisfaction.

const MF_PREFIX = "@module-federation/";

const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function loadWorkspaceCatalog(): Record<string, string> {
  const workspace = parse(
    readFileSync(join(import.meta.dirname, "../../../../pnpm-workspace.yaml"), "utf8"),
  ) as { catalog?: Record<string, string> };
  return workspace.catalog ?? {};
}

interface LockfileCatalogRow {
  specifier?: string;
  version?: string;
}

function loadLockfileCatalogRows(): Record<string, LockfileCatalogRow> {
  const raw = readFileSync(join(import.meta.dirname, "../../../../pnpm-lock.yaml"), "utf8");
  const documents = parseAllDocuments<Record<string, unknown>>(raw, { strict: false })
    .map((document) => document.toJS() as Record<string, unknown> | null)
    .filter((document): document is Record<string, unknown> => document !== null);
  const lockfile = documents.find((document) => "catalogs" in document);
  const catalogs = (lockfile?.catalogs ?? {}) as Record<string, Record<string, LockfileCatalogRow>>;
  return catalogs.default ?? {};
}

function mfCatalogRows(catalog: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(catalog).filter(([name]) => name.startsWith(MF_PREFIX)));
}

describe("MF catalog pins", () => {
  it("pins every @module-federation/* row to an exact version", () => {
    const rows = mfCatalogRows(loadWorkspaceCatalog());
    expect(
      Object.keys(rows).length,
      "the catalog must ship @module-federation/* rows",
    ).toBeGreaterThan(0);
    const floating = Object.entries(rows)
      .filter(([, version]) => !EXACT_VERSION_RE.test(version))
      .map(([name, version]) => `  "${name}": "${version}",`);
    expect(
      floating,
      [
        "@module-federation/* catalog rows must be exact (no ^, ~, or range) —",
        "children inherit these rows verbatim and the host image's mf-compat",
        "gate requires pluginVersion equality, so a floating row re-resolves",
        "children past the image and fails every deploy smoke (#933).",
        "Bump these rows deliberately, together with pnpm-lock.yaml:",
        floating.join("\n"),
      ].join("\n"),
    ).toEqual([]);
  });

  it("matches the lockfile's recorded catalog specifiers and resolutions", () => {
    const catalog = mfCatalogRows(loadWorkspaceCatalog());
    const lockfileRows = loadLockfileCatalogRows();
    const stale = Object.entries(catalog)
      .filter(([name]) => name in lockfileRows)
      .flatMap(([name, version]) => {
        const row = lockfileRows[name]!;
        if (row.specifier !== version || row.version !== version) {
          return [
            `  "${name}": catalog=${version}, lockfile specifier=${row.specifier}, resolved=${row.version}`,
          ];
        }
        return [];
      });
    expect(
      stale,
      [
        "pnpm-lock.yaml's catalogs.default disagrees with pnpm-workspace.yaml —",
        "run `pnpm install --lockfile-only` after changing catalog rows, or CI's",
        "--frozen-lockfile install fails:",
        stale.join("\n"),
      ].join("\n"),
    ).toEqual([]);
  });
});
