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

export async function activatePersonalOrganizationForSession(
  database: Database,
  session: { id: string; userId: string; activeOrganizationId?: string | null },
) {
  if (session.activeOrganizationId) {
    return;
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
