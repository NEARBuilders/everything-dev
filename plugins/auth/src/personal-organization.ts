import { and, eq } from "drizzle-orm";
import type { Database } from "./db/layer";
import * as schema from "./db/schema";
import { tryJsonParse } from "./utils";

export const PERSONAL_ORGANIZATION_METADATA = JSON.stringify({ isPersonal: true });

export function isPersonalOrganization(
  organization: { slug: string; metadata?: unknown } | null | undefined,
  userId: string,
): boolean {
  if (!organization) return false;
  const metadata =
    typeof organization.metadata === "string"
      ? tryJsonParse<{ isPersonal?: unknown }>(organization.metadata)
      : organization.metadata;
  if (metadata && typeof metadata === "object") {
    if ((metadata as { isPersonal?: unknown }).isPersonal === true) {
      return true;
    }
  }
  return organization.slug === userId;
}

export async function findPersonalOrganization(database: Database, userId: string) {
  return database.query.organization.findFirst({
    where: and(
      eq(schema.organization.slug, userId),
      eq(schema.organization.metadata, PERSONAL_ORGANIZATION_METADATA),
    ),
  });
}

export async function ensurePersonalOrganization(
  database: Database,
  user: { id: string; name?: string | null; isAnonymous?: boolean | null },
) {
  if (user.isAnonymous) {
    return null;
  }

  const existingOrg = await findPersonalOrganization(database, user.id);
  if (existingOrg) {
    return existingOrg;
  }

  const [personalOrg] = await database
    .insert(schema.organization)
    .values({
      id: crypto.randomUUID(),
      name: user.name || "Personal",
      slug: user.id,
      logo: null,
      metadata: PERSONAL_ORGANIZATION_METADATA,
      createdAt: new Date(),
    })
    .returning();

  if (!personalOrg) {
    throw new Error("Failed to create personal organization");
  }

  await database.insert(schema.member).values({
    id: crypto.randomUUID(),
    userId: user.id,
    organizationId: personalOrg.id,
    role: "owner",
    createdAt: new Date(),
  });

  return personalOrg;
}

export async function rememberActiveOrganization(
  database: Database,
  userId: string,
  organizationId: string | null,
  teamId?: string | null,
) {
  const current = await database.query.user.findFirst({
    where: eq(schema.user.id, userId),
    columns: { lastActiveOrganizationId: true, lastActiveTeamId: true },
  });
  if (!current) {
    return;
  }
  const nextTeamId = teamId === undefined ? current.lastActiveTeamId : (teamId ?? null);
  if (
    current.lastActiveOrganizationId === organizationId &&
    current.lastActiveTeamId === nextTeamId
  ) {
    return;
  }
  await database
    .update(schema.user)
    .set({ lastActiveOrganizationId: organizationId, lastActiveTeamId: nextTeamId })
    .where(eq(schema.user.id, userId));
}

export async function mirrorSessionOrganizationChoice(
  database: Database,
  session: Partial<{
    userId: string;
    activeOrganizationId: string | null;
    activeTeamId: string | null;
  }>,
) {
  if (!session.userId || !session.activeOrganizationId) {
    return;
  }
  await rememberActiveOrganization(
    database,
    session.userId,
    session.activeOrganizationId,
    session.activeTeamId === undefined ? undefined : (session.activeTeamId ?? null),
  );
}

async function restorePreferredTeam(
  database: Database,
  userId: string,
  organizationId: string,
  preferredTeamId: string | null | undefined,
) {
  if (!preferredTeamId) {
    return null;
  }
  const [team] = await database
    .select({ id: schema.team.id, organizationId: schema.team.organizationId })
    .from(schema.teamMember)
    .innerJoin(schema.team, eq(schema.teamMember.teamId, schema.team.id))
    .where(and(eq(schema.teamMember.userId, userId), eq(schema.team.id, preferredTeamId)))
    .limit(1);
  return team?.organizationId === organizationId ? team.id : null;
}

export async function activateDefaultOrganizationForSession(
  database: Database,
  session: { id: string; userId: string; activeOrganizationId?: string | null },
) {
  if (session.activeOrganizationId) {
    return;
  }

  const preferences = await database.query.user.findFirst({
    where: eq(schema.user.id, session.userId),
    columns: { lastActiveOrganizationId: true, lastActiveTeamId: true },
  });
  const preferredOrgId = preferences?.lastActiveOrganizationId ?? null;

  if (preferredOrgId) {
    const organization = await database.query.organization.findFirst({
      where: eq(schema.organization.id, preferredOrgId),
    });
    const membership = await database.query.member.findFirst({
      where: and(
        eq(schema.member.userId, session.userId),
        eq(schema.member.organizationId, preferredOrgId),
      ),
    });
    if (organization?.status === "active" && membership) {
      const restoredTeamId = await restorePreferredTeam(
        database,
        session.userId,
        preferredOrgId,
        preferences?.lastActiveTeamId,
      );
      await database
        .update(schema.session)
        .set({
          activeOrganizationId: preferredOrgId,
          ...(restoredTeamId ? { activeTeamId: restoredTeamId } : {}),
        })
        .where(eq(schema.session.id, session.id));
      return;
    }
  }

  const personalOrg = await findPersonalOrganization(database, session.userId);
  if (!personalOrg || personalOrg.status !== "active") {
    return;
  }
  await database
    .update(schema.session)
    .set({ activeOrganizationId: personalOrg.id })
    .where(eq(schema.session.id, session.id));
}
