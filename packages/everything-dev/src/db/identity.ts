import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getDatabaseUrlSecretName,
  getMigrationSlug,
  getMigrationStorage,
  type MigrationStorage,
} from "./core";

/**
 * The database identity of a workspace: everything downstream consumers need
 * (drizzle-kit configs, migration runners, tooling CLIs) is a pure function of
 * these values. Identity has one source of truth — the workspace's
 * package.json — and must never be guessed from ambient process state
 * (cwd, npm_package_name, shell env).
 */
export interface WorkspaceIdentity {
  readonly slug: string;
  readonly secretName: string;
  readonly journal: MigrationStorage;
  readonly workspaceDir: string | undefined;
}

/**
 * Walk up from a directory to the nearest ancestor containing a package.json.
 * Returns the start directory when none is found.
 */
export function findWorkspaceDir(startDir: string): string {
  let current = startDir;
  for (let i = 0; i < 15; i++) {
    if (existsSync(join(current, "package.json"))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return startDir;
}

/**
 * Derive workspace identity from a workspace directory.
 */
export function workspaceIdentityFromWorkspaceDir(dir: string): WorkspaceIdentity {
  const workspaceDir = findWorkspaceDir(dir);
  const slug = getMigrationSlug(workspaceDir);
  return {
    slug,
    secretName: getDatabaseUrlSecretName(slug),
    journal: getMigrationStorage(slug),
    workspaceDir,
  };
}

/**
 * Derive workspace identity from a module's own location.
 *
 * This is the primitive for drizzle.config.ts files: `import.meta.url` is the
 * one module-identity fact that survives every config loader we run under —
 * real ESM (Node/Bun) and drizzle-kit's bundled tsx CJS transform (which
 * defines `import.meta.url` but NOT `import.meta.dirname`, leaving that
 * `undefined` in evaluated configs).
 *
 * Pass the member expression itself (`workspaceIdentityFromModuleUrl(import.meta.url)`)
 * so the transform substitutes the value; do not pass the `import.meta` object.
 */
export function workspaceIdentityFromModuleUrl(moduleUrl: string): WorkspaceIdentity {
  const modulePath = moduleUrl.startsWith("file:") ? fileURLToPath(moduleUrl) : moduleUrl;
  return workspaceIdentityFromWorkspaceDir(dirname(modulePath));
}
