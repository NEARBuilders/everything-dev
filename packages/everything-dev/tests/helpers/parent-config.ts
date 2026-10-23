import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { openResolution } from "../../src/services/resolution/session";

const REPO_ROOT = join(import.meta.dirname, "../../../..");

/**
 * The base repo authors its config in `bos.app.ts` — no committed
 * `bos.config.json`. Tests that need the parent-config shape resolve it
 * through the same session the CLI uses.
 */
export async function loadParentConfigFixture(): Promise<Record<string, any>> {
  const session = await openResolution({ cwd: REPO_ROOT, env: "development" });
  return (session?.config ?? {}) as Record<string, any>;
}

/**
 * Writes a child `bos.config.json` shaped like the scaffold output of a
 * published parent (production URLs + integrity present, so personalization
 * has inherited state to strip).
 */
export function writeChildConfigFixture(
  dir: string,
  sections: Array<"host" | "ui" | "api"> = [],
  plugins: Record<string, unknown> = {
    registry: { development: "local:plugins/registry" },
  },
): void {
  // sections mirror the child's override list — host stays when the child
  // overrides host
  const app: Record<string, unknown> = {};
  for (const section of sections) {
    app[section] = {
      development: `local:${section}`,
      production: `https://cdn.example.test/bundles/dev.everything.near/everything.dev/${section}/`,
      integrity: `sha384-${section}`,
      ...(section === "host" ? { secrets: ["CORS_ORIGIN", "CSP_STRICT"] } : {}),
      ...(section === "api" ? { secrets: ["API_DATABASE_URL"] } : {}),
    };
  }
  writeFileSync(
    join(dir, "bos.config.json"),
    `${JSON.stringify(
      {
        account: "dev.everything.near",
        domain: "everything.dev",
        app: {
          ...app,
          auth: {
            development: "local:plugins/auth",
            name: "@everything-dev/auth-plugin",
            secrets: ["AUTH_DATABASE_URL", "BETTER_AUTH_SECRET"],
          },
        },
        plugins,
      },
      null,
      2,
    )}\n`,
  );
}

const DEFAULT_CHILD_PLUGINS: Record<string, unknown> = {
  registry: { development: "local:plugins/registry" },
};

function childConfigObject(
  sections: Array<"host" | "ui" | "api"> = [],
  plugins: Record<string, unknown> = DEFAULT_CHILD_PLUGINS,
): Record<string, unknown> {
  const descriptor: Record<string, unknown> = {};
  for (const section of sections) {
    descriptor[section] = {
      development: `local:${section}`,
      ...(section === "host" ? { secrets: ["CORS_ORIGIN", "CSP_STRICT"] } : {}),
      ...(section === "api" ? { secrets: ["API_DATABASE_URL"] } : {}),
    };
  }
  // The authored descriptor is AppDescriptorSchema — no pipeline fields
  // (production/integrity) and host/api/ui at the top level: personalization
  // strips inherited deploy state by removing keys that never appear here.
  return {
    extends: "bos://dev.everything.near/everything.dev",
    account: "dev.everything.near",
    domain: "everything.dev",
    ...descriptor,
    auth: {
      development: "local:plugins/auth",
      secrets: ["AUTH_DATABASE_URL", "BETTER_AUTH_SECRET"],
    },
    plugins: {
      ...plugins,
    },
  };
}

/**
 * Writes the authored `bos.app.ts` fixture shaped like a child scaffolded
 * from a published parent (production URLs + integrity present, so
 * personalization has inherited state to strip).
 *
 * A plain object default-export — no imports — so the tempdir fixture loads
 * without a node_modules link (the loader only needs an AppDescriptorSchema
 * parse, and `App()` is identity over its data argument).
 */
export function writeChildAppDescriptorFixture(
  dir: string,
  sections: Array<"host" | "ui" | "api"> = [],
  plugins: Record<string, unknown> = DEFAULT_CHILD_PLUGINS,
): void {
  const config = { name: "test.dev", ...childConfigObject(sections, plugins) };
  const body = JSON.stringify(config, null, 2).replace(
    /^(\s*)"([A-Za-z_$][A-Za-z0-9_$]*)":/gm,
    "$1$2:",
  );
  writeFileSync(join(dir, "bos.app.ts"), `export default ${body};\n`);
}
