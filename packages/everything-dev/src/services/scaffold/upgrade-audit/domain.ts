import { Data } from "effect";
import { formatUnknownError } from "../../../utils/errors";

export type CheckId =
  | "routes"
  | "route-guards"
  | "config"
  | "imports"
  | "ui-seam"
  | "db-topology"
  | "i18n-seam"
  | "compose-seam";

export type RouterSeam = "monolithic" | "authored-seam" | "unknown" | "absent";

export type Severity = "blocker" | "warn";

export class Finding extends Data.TaggedClass("Finding")<{
  readonly check: CheckId;
  readonly path: string;
  readonly severity: Severity;
  readonly message: string;
}> {}

export class GateBlocked extends Data.TaggedError("GateBlocked")<{
  readonly findings: readonly Finding[];
}> {}

export class AuditFileError extends Data.TaggedError("AuditFileError")<{
  readonly op: "glob" | "stat" | "read" | "write" | "remove" | "command";
  readonly target: string;
  readonly cause: unknown;
}> {
  get message(): string {
    return `${this.op} failed for ${this.target ?? "—"}: ${formatUnknownError(this.cause)}`;
  }

  override toString(): string {
    return this.message;
  }
}

export class AuditStepError extends Data.TaggedError("AuditStepError")<{
  readonly step: string;
  readonly message: string;
  readonly cause?: unknown;
}> {
  override toString(): string {
    return this.cause === undefined
      ? this.message
      : `${this.message}: ${formatUnknownError(this.cause)}`;
  }
}

export interface ImportRewrite {
  readonly from: string;
  readonly to: string;
  readonly files: readonly string[];
}

export interface PluginInventory {
  readonly name: string;
  readonly hasBackend: boolean;
  readonly hasWeb: boolean;
  readonly extendsParent: boolean;
  readonly variables: readonly string[];
  readonly secrets: readonly string[];
}

export interface Manifest {
  readonly tier: "A" | "B";
  readonly blockerCount: number;
  readonly warnCount: number;
  readonly deleteFiles: readonly string[];
  readonly importRewrites: readonly ImportRewrite[];
  readonly configKeys: readonly string[];
  readonly routerSeam: RouterSeam;
  readonly authoredConfigTarget: "bos.app.ts";
  readonly plugins: readonly PluginInventory[];
  readonly db: {
    readonly schemaFile: string | null;
    readonly migrationsDir: string | null;
  };
}

export interface AuditReport {
  readonly tier: "A" | "B";
  readonly findings: readonly Finding[];
  readonly manifest: Manifest;
}

export const KNOWN_CONFIG_KEYS = [
  "extends",
  "account",
  "domain",
  "title",
  "description",
  "testnet",
  "staging",
  "repository",
  "ci",
  "app",
  "plugins",
] as const;

export const KNOWN_APP_SLOT_KEYS = [
  "development",
  "production",
  "integrity",
  "ssr",
  "ssrIntegrity",
  "secrets",
  "shared",
  "extends",
  "proxy",
  "routes",
] as const;

export const KNOWN_PLUGIN_KEYS = [
  "development",
  "production",
  "integrity",
  "extends",
  "variables",
  "secrets",
  "routes",
  "proxy",
  "sidebar",
  "shared",
] as const;

export const MOUNT_ALIASES: Readonly<Record<string, string>> = {
  auth: "authenticated",
};

export const KNOWN_MOUNTS = ["public", "authenticated", "admin", "anon", "organization"] as const;
