/**
 * The registry's typed key model — the one derivation every reader and
 * writer shares. A key is a closed union; its wire form (`keyPathOf`) is the
 * exact FastKV key string (`apps/<account>/<gateway>/…`). Consumers never
 * hand-build registry paths: the golden tests pin the wire forms, and the
 * invariant they encode is the one this module exists to make provable —
 * the account segment is the signing namespace (`dev.everything.near`), the
 * gateway segment is the runtime's domain (`everything.dev`), and nothing
 * that reads or writes may derive one from the other.
 *
 * Vocabulary (the sprint's decision ledger, .scratch/registry-primitive):
 * - `RuntimeRef` — `bos://<account>/<gateway>`: a runtime's identity.
 * - `RuntimeConfig` — the runtime's composition (bos.config.json).
 * - `Manifest` — the moving release tag (manifest.json, thin: version + digest).
 * - `Version` — the immutable per-release record (versions/<v>.json).
 * - `DeployRecord` — the per-deploy audit trail (deploys/<ts>.json).
 */

export type RuntimeRef = `bos://${string}/${string}`;

export interface RuntimeRefParts {
  accountId: string;
  gatewayId: string;
}

export type RegistryKey =
  | { readonly kind: "runtimeConfig"; readonly ref: RuntimeRef; readonly path?: readonly string[] }
  | { readonly kind: "manifest"; readonly ref: RuntimeRef }
  | { readonly kind: "version"; readonly ref: RuntimeRef; readonly version: string }
  | { readonly kind: "deployRecord"; readonly ref: RuntimeRef; readonly ts: string };

export class RegistryRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryRefError";
  }
}

/** `runtimeRefOf({ accountId, gatewayId })` — the runtime identity. */
export function runtimeRefOf(parts: RuntimeRefParts): RuntimeRef {
  if (!parts.accountId || !parts.gatewayId) {
    throw new RegistryRefError(
      `Invalid runtime ref: account "${parts.accountId}", gateway "${parts.gatewayId}" — both segments are required`,
    );
  }
  return `bos://${parts.accountId}/${parts.gatewayId}`;
}

/**
 * Parse a runtime ref into its parts. Extra path segments beyond
 * `<gateway>` are the config sub-path (`bos://a/g/team/app` →
 * `path: ["team", "app"]`); a `#fragment` is stripped. Throws
 * `RegistryRefError` on any malformed ref.
 */
export function parseRuntimeRef(ref: RuntimeRef | string): RuntimeRefParts & { path: string[] } {
  const stripped = ref.split("#")[0]!;
  const match = stripped.match(/^bos:\/\/([^/]+)\/(.+)$/);
  if (!match?.[1] || !match[2]) {
    throw new RegistryRefError(`Invalid runtime ref: ${ref}`);
  }
  const segments = match[2]
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  const [gatewayId, ...path] = segments;
  if (!gatewayId) {
    throw new RegistryRefError(`Invalid runtime ref: ${ref}`);
  }
  return { accountId: match[1]!, gatewayId, path };
}

const singleSegment = (value: string, label: string): string => {
  if (!value || value.includes("/")) {
    throw new RegistryRefError(
      `Invalid registry key: ${label} "${value}" must be one path segment`,
    );
  }
  return value;
};

/** The exact wire key for a registry key — raw (unencoded); the client
 * encodes it as a single path segment per the FastKV read API. */
export function keyPathOf(key: RegistryKey): string {
  const { accountId, gatewayId } = parseRuntimeRef(key.ref);
  switch (key.kind) {
    case "runtimeConfig": {
      const suffix = (key.path ?? []).map((segment) => singleSegment(segment, "config path"));
      return ["apps", accountId, gatewayId, ...suffix, "bos.config.json"].join("/");
    }
    case "manifest":
      return ["apps", accountId, gatewayId, "manifest.json"].join("/");
    case "version":
      return [
        "apps",
        accountId,
        gatewayId,
        "versions",
        `${singleSegment(key.version, "version")}.json`,
      ].join("/");
    case "deployRecord":
      return [
        "apps",
        accountId,
        gatewayId,
        "deploys",
        `${singleSegment(key.ts, "deploy timestamp")}.json`,
      ].join("/");
  }
}
