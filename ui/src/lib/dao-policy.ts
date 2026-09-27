/**
 * Pure helpers for parsing sputnik-dao v2 policy responses and producing
 * the registry config payload the tenant wizard publishes.
 */

export interface NearPolicyRoleGroup {
  kind: { Group: string[] };
  name: string;
}

export interface NearPolicyRoleEveryone {
  kind: "Everyone";
  name: string;
}

export type NearPolicyRole = NearPolicyRoleGroup | NearPolicyRoleEveryone;

export interface NearPolicy {
  roles: NearPolicyRole[];
}

export function parsePolicyGroupMembers(policy: unknown): string[] {
  if (!policy || typeof policy !== "object") return [];
  const raw = policy as Partial<NearPolicy>;
  if (!Array.isArray(raw.roles)) return [];
  const members = new Set<string>();
  for (const role of raw.roles) {
    if (!role || typeof role !== "object") continue;
    const kind = (role as { kind?: unknown }).kind;
    if (!kind || typeof kind !== "object") continue;
    const list = (kind as { Group?: unknown }).Group;
    if (!Array.isArray(list)) continue;
    for (const id of list) {
      if (typeof id === "string" && id.length > 0) {
        members.add(id);
      }
    }
  }
  return [...members];
}

export function isExplicitDaoMember(policy: unknown, accountId: string): boolean {
  return parsePolicyGroupMembers(policy).includes(accountId);
}

import type { TenantUiOverride } from "@/app";

export interface TenantPublishConfigInput {
  daoAccountId: string;
  gatewayId: string;
  baseAccount: string;
  hostname: string;
  title: string;
  description?: string;
  repository?: string;
  app?: { ui: TenantUiOverride };
  status?: "active" | "suspended" | "pending_deletion";
}

export interface TenantPublishConfig {
  extends: string;
  account: string;
  domain: string;
  title: string;
  description: string;
  repository?: string;
  app?: { ui: TenantUiOverride };
  status?: "active" | "suspended" | "pending_deletion";
}

export function buildTenantPublishConfig(input: TenantPublishConfigInput): TenantPublishConfig {
  const config: TenantPublishConfig = {
    extends: `bos://${input.baseAccount}/${input.gatewayId}`,
    account: input.daoAccountId,
    domain: input.hostname,
    title: input.title,
    description: input.description ?? input.title,
    ...(input.repository ? { repository: input.repository } : {}),
    ...(input.app ? { app: input.app } : {}),
  };
  if (input.status) config.status = input.status;
  return config;
}
