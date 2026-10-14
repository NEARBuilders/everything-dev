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

export function toOrganizationRecord<T extends { metadata: string | null }>(organization: T) {
  return {
    ...organization,
    metadata: tryJsonParse<Record<string, unknown>>(organization.metadata),
  };
}

export function toInvitation(invitation: any) {
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    expiresAt:
      invitation.expiresAt instanceof Date ? invitation.expiresAt : new Date(invitation.expiresAt),
    inviterId: invitation.inviterId,
    teamId: invitation.teamId ?? null,
    nearAccountId: invitation.nearAccountId ?? null,
    nearNetwork: invitation.nearNetwork ?? null,
  };
}

export function toTeam(team: any) {
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
