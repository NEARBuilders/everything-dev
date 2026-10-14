import { parseTeamAreas, tryJsonParse } from "./utils";

export function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return value ? new Date(value as string) : new Date();
}

export function toOrganizationInfo(organization: {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  metadata?: unknown;
  status?: string;
  requestedBy?: string | null;
  rejectionReason?: string | null;
}): {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  status: "active" | "pending" | "rejected";
  requestedBy: string | null;
  rejectionReason: string | null;
  metadata: Record<string, unknown> | null;
} {
  const status =
    organization.status === "pending" || organization.status === "rejected"
      ? organization.status
      : "active";
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    logo: organization.logo ?? null,
    status,
    requestedBy: organization.requestedBy ?? null,
    rejectionReason: organization.rejectionReason ?? null,
    metadata:
      typeof organization.metadata === "string"
        ? (tryJsonParse<Record<string, unknown>>(organization.metadata) ?? null)
        : ((organization.metadata as Record<string, unknown> | null | undefined) ?? null),
  };
}

export function toOrganizationRecord<T extends { metadata: string | null }>(
  organization: T,
): Omit<T, "metadata"> & { metadata: Record<string, unknown> | null } {
  return {
    ...organization,
    metadata: tryJsonParse<Record<string, unknown>>(organization.metadata),
  };
}

export interface InvitationRow {
  id: string;
  organizationId: string;
  email?: string | null;
  role?: string | null;
  status: string;
  expiresAt: Date | string;
  inviterId: string;
  teamId?: string | null;
  nearAccountId?: string | null;
  nearNetwork?: string | null;
}

export function toInvitation(invitation: InvitationRow) {
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email ?? null,
    role: invitation.role ?? null,
    status: invitation.status,
    expiresAt:
      invitation.expiresAt instanceof Date ? invitation.expiresAt : new Date(invitation.expiresAt),
    inviterId: invitation.inviterId,
    teamId: invitation.teamId ?? null,
    nearAccountId: invitation.nearAccountId ?? null,
    nearNetwork: (invitation.nearNetwork as "mainnet" | "testnet" | null | undefined) ?? null,
  };
}

export interface TeamRow {
  id: string;
  name: string;
  organizationId: string;
  metadata?: unknown;
  createdAt: Date | string;
  updatedAt?: Date | string;
}

export function toTeam(team: TeamRow) {
  return {
    id: team.id,
    name: team.name,
    organizationId: team.organizationId,
    areas: parseTeamAreas(team.metadata),
    createdAt: toDate(team.createdAt),
    updatedAt: toDate(team.updatedAt),
  };
}

export function toOnboardingSummary(row: {
  id: string;
  eventId: string | null;
  eventName: string;
  teamId: string;
  role: string;
  maxUses: number;
  usedCount: number;
  expiresAt: Date | string;
  revokedAt: Date | null;
  createdAt: Date | string;
}) {
  return {
    id: row.id,
    eventId: row.eventId,
    eventName: row.eventName,
    teamId: row.teamId,
    role: row.role,
    maxUses: row.maxUses,
    usedCount: row.usedCount,
    expiresAt: toDate(row.expiresAt),
    revokedAt: row.revokedAt ? toDate(row.revokedAt) : null,
    createdAt: toDate(row.createdAt),
  };
}
