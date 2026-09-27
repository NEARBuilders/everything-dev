/**
 * Tenant helpers shared by every ui workspace.
 *
 * Two halves of the tenant surface live here:
 * - origin construction (`buildTenantUrl`, `tenantLabel`, `gatewayForAccount`)
 * - the pure helpers for the org node-config editor: a validated draft of the
 *   fields a tenant may customize in its published bos.config.json, prefilled
 *   from the currently published config, diffed against it, and an in-browser
 *   sha384 preflight so a wrong UI bundle cannot brick the tenant site.
 */

import { z } from "zod";
import type { ClientRuntimeConfig } from "../types";
import { UI_REMOTE_ENTRY_FILENAME, UI_REMOTE_SERVER_ENTRY_FILENAME } from "./manifest";
import { getRuntimeConfig } from "./runtime";

const LOCALHOST_SUFFIX = ".localhost";

export function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "[::1]" ||
    normalized.endsWith(LOCALHOST_SUFFIX)
  );
}

/** Strips a `<label>.<gatewayId>` hostname (or a bare label) down to its label. */
export function tenantLabel(hostnameOrLabel: string, gatewayId?: string): string {
  const normalized = hostnameOrLabel.trim().toLowerCase().replace(/\/+$/, "");
  if (!normalized) return "";
  const gateway = gatewayId?.trim().toLowerCase();
  if (gateway && normalized.endsWith(`.${gateway}`)) {
    return normalized.slice(0, -(gateway.length + 1));
  }
  if (normalized.endsWith(LOCALHOST_SUFFIX)) {
    return normalized.slice(0, -LOCALHOST_SUFFIX.length);
  }
  return normalized.split(".")[0] ?? "";
}

export interface BuildTenantUrlOptions {
  /** Current browser origin hostname. Defaults to `window.location.hostname`. */
  currentHostname?: string;
  /** Current browser origin port. Defaults to `window.location.port`. */
  currentPort?: string;
  /** Appended to the origin, e.g. `/stake`. */
  path?: string;
}

/**
 * Builds the absolute origin for a tenant, dev-aware.
 *
 * `buildTenantUrl("chicago", "citynode.app")`
 *   -> `https://chicago.citynode.app` in production
 *   -> `http://chicago.localhost:3000` when served from localhost
 */
export function buildTenantUrl(
  hostnameOrLabel: string,
  gatewayId: string,
  options: BuildTenantUrlOptions = {},
): string | null {
  const label = tenantLabel(hostnameOrLabel, gatewayId);
  if (!label) return null;

  const path = options.path ?? "";
  const currentHostname =
    options.currentHostname ??
    (typeof window === "undefined" ? undefined : window.location.hostname);

  if (currentHostname && isLocalHostname(currentHostname)) {
    const currentPort =
      options.currentPort ?? (typeof window === "undefined" ? "" : window.location.port);
    const port = currentPort ? `:${currentPort}` : "";
    return `http://${label}${LOCALHOST_SUFFIX}${port}${path}`;
  }

  const gateway = gatewayId.trim().toLowerCase();
  if (!gateway) return null;
  return `https://${label}.${gateway}${path}`;
}

/**
 * The gateway a slug should publish under for the given owner account,
 * derived from the runtime config instead of hardcoded per-network domains.
 *
 * When the account lives on the same network as the runtime, the current
 * runtime's gateway id is the answer. When the networks differ, the runtime
 * config carries no gateway for that other network, so null is returned and
 * the caller surfaces it rather than guessing a domain.
 */
export function gatewayForAccount(
  accountId: string,
  config: Pick<ClientRuntimeConfig, "networkId" | "runtime"> = getRuntimeConfig(),
): string | null {
  const gatewayId = config.runtime?.gatewayId;
  if (!gatewayId) return null;
  const testnetAccount = accountId.trim().toLowerCase().endsWith(".testnet");
  return testnetAccount === (config.networkId === "testnet") ? gatewayId : null;
}

export interface TenantUiOverride {
  production: string;
  integrity: string;
  ssr?: string;
  ssrIntegrity?: string;
}

export const INTEGRITY_PATTERN = /^sha384-[A-Za-z0-9+/=]+$/;

const optionalUrl = z
  .string()
  .trim()
  .url("must be a valid URL")
  .or(z.literal(""))
  .transform((value) => value.trim());

const optionalIntegrity = z
  .string()
  .trim()
  .regex(INTEGRITY_PATTERN, "must look like sha384-… (base64)")
  .or(z.literal(""));

export const tenantConfigDraftSchema = z
  .object({
    title: z.string().trim().min(1, "title is required"),
    description: z.string().trim().min(1, "description is required"),
    repository: optionalUrl,
    uiProduction: optionalUrl,
    uiIntegrity: optionalIntegrity,
    ssrUrl: optionalUrl,
    ssrIntegrity: optionalIntegrity,
  })
  .refine((draft) => !!draft.uiProduction === !!draft.uiIntegrity, {
    message: "a UI bundle needs both its URL and its integrity hash",
    path: ["uiIntegrity"],
  })
  .refine((draft) => !!draft.ssrUrl === !!draft.ssrIntegrity, {
    message: "an SSR bundle needs both its URL and its integrity hash",
    path: ["ssrIntegrity"],
  });

export type TenantConfigDraft = z.infer<typeof tenantConfigDraftSchema>;

export const emptyTenantConfigDraft: TenantConfigDraft = {
  title: "",
  description: "",
  repository: "",
  uiProduction: "",
  uiIntegrity: "",
  ssrUrl: "",
  ssrIntegrity: "",
};

interface ResolvedUiConfig {
  production?: unknown;
  integrity?: unknown;
  ssr?: unknown;
  ssrIntegrity?: unknown;
}

function readUi(resolvedConfig: Record<string, unknown> | null | undefined): ResolvedUiConfig {
  const app = resolvedConfig?.app as { ui?: ResolvedUiConfig } | undefined;
  return app?.ui ?? {};
}

const asString = (value: unknown) => (typeof value === "string" ? value : "");

export function buildDraftFromResolvedConfig(
  resolvedConfig: Record<string, unknown> | null | undefined,
  fallback: { title: string },
): TenantConfigDraft {
  const ui = readUi(resolvedConfig);
  const title = asString(resolvedConfig?.title) || fallback.title;
  return {
    title,
    description: asString(resolvedConfig?.description) || title,
    repository: asString(resolvedConfig?.repository),
    uiProduction: asString(ui.production),
    uiIntegrity: asString(ui.integrity),
    ssrUrl: asString(ui.ssr),
    ssrIntegrity: asString(ui.ssrIntegrity),
  };
}

export interface DraftDiffEntry {
  field: string;
  from: string;
  to: string;
}

export function diffDraft(
  draft: TenantConfigDraft,
  resolvedConfig: Record<string, unknown> | null | undefined,
): DraftDiffEntry[] {
  const ui = readUi(resolvedConfig);
  const pairs: [string, string, string][] = [
    ["title", asString(resolvedConfig?.title), draft.title],
    ["description", asString(resolvedConfig?.description), draft.description],
    ["repository", asString(resolvedConfig?.repository), draft.repository],
    ["ui bundle", asString(ui.production), draft.uiProduction],
    ["ui integrity", asString(ui.integrity), draft.uiIntegrity],
    ["ssr bundle", asString(ui.ssr), draft.ssrUrl],
    ["ssr integrity", asString(ui.ssrIntegrity), draft.ssrIntegrity],
  ];
  return pairs
    .filter(([, from, to]) => from !== to)
    .map(([field, from, to]) => ({ field, from: from || "—", to: to || "—" }));
}

/** The `app` block for the published config, or undefined when no UI override is set. */
export function draftUiOverride(draft: TenantConfigDraft): { ui: TenantUiOverride } | undefined {
  if (!draft.uiProduction || !draft.uiIntegrity) return undefined;
  return {
    ui: {
      production: normalizeBundleBaseUrl(draft.uiProduction),
      integrity: draft.uiIntegrity,
      ...(draft.ssrUrl && draft.ssrIntegrity
        ? { ssr: normalizeBundleBaseUrl(draft.ssrUrl), ssrIntegrity: draft.ssrIntegrity }
        : {}),
    },
  };
}

export type IntegrityCheckResult =
  | { status: "match" }
  | { status: "mismatch"; computed: string }
  | { status: "unverified"; reason: string };

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function computeSubresourceIntegrity(url: string): Promise<string> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`fetching the bundle returned ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-384", buffer);
  return `sha384-${toBase64(new Uint8Array(digest))}`;
}

export function resolveClientEntryUrl(url: string): string {
  if (url.endsWith(`/${UI_REMOTE_ENTRY_FILENAME}`)) return url;
  if (url.endsWith("/mf-manifest.json"))
    return `${url.replace(/\/mf-manifest\.json$/, "")}/${UI_REMOTE_ENTRY_FILENAME}`;
  return `${url.replace(/\/$/, "")}/${UI_REMOTE_ENTRY_FILENAME}`;
}

export function resolveServerEntryUrl(url: string): string {
  return `${url.replace(/\/$/, "")}/${UI_REMOTE_SERVER_ENTRY_FILENAME}`;
}

export function normalizeBundleBaseUrl(url: string): string {
  return url
    .trim()
    .replace(/\/remoteEntry(\.server)?\.js$/, "")
    .replace(/\/mf-manifest\.json$/, "");
}

export async function computeUiEntryIntegrity(baseUrl: string): Promise<string> {
  return computeSubresourceIntegrity(resolveClientEntryUrl(baseUrl.trim()));
}

export async function computeSsrEntryIntegrity(baseUrl: string): Promise<string> {
  return computeSubresourceIntegrity(resolveServerEntryUrl(baseUrl.trim()));
}

async function verifyEntryIntegrity(
  entryUrl: string,
  expected: string,
): Promise<IntegrityCheckResult> {
  try {
    const computed = await computeSubresourceIntegrity(entryUrl);
    return computed === expected ? { status: "match" } : { status: "mismatch", computed };
  } catch (error) {
    return {
      status: "unverified",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function verifyUiIntegrity(
  baseUrl: string,
  expected: string,
): Promise<IntegrityCheckResult> {
  return verifyEntryIntegrity(resolveClientEntryUrl(baseUrl.trim()), expected);
}

export async function verifySsrIntegrity(
  baseUrl: string,
  expected: string,
): Promise<IntegrityCheckResult> {
  return verifyEntryIntegrity(resolveServerEntryUrl(baseUrl.trim()), expected);
}
