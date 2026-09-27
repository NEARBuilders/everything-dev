import { rmSync } from "node:fs";
import { Effect } from "effect";
import { getMigrationStorage, pluginMigrationSlug } from "everything-dev/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabaseDriver } from "@/db/index";
import { loadMigrations, migrate } from "@/db/migrate";
import { discoveryActivities, nodes, tenants } from "@/db/schema";
import pluginDevConfig from "../../plugin.dev";
import { daoContext, getPluginClient, orgContext, teardown } from "../setup";

const databaseDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "event-onboarding-"));
  process.env.API_TEST_DATABASE_URL = `pglite:${dir}`;
  process.env.API_DATABASE_URL = `pglite:${dir}`;
  return dir;
});

vi.mock("@/services/dao", () => ({
  verifyDaoMembership: vi.fn(() =>
    Effect.succeed({ isSputnikContract: true, isMember: true, policy: { roles: [] } }),
  ),
  parsePolicyGroupMembers: vi.fn(() => []),
  isExplicitDaoMember: vi.fn(() => true),
}));

type ForwardedCall = { context: unknown; input: Record<string, unknown> };

const forwarded: ForwardedCall[] = [];

const authStub = {
  client: (context: unknown) => ({
    createOnboardingCode: async (input: Record<string, unknown>) => {
      forwarded.push({ context, input });
      const now = new Date();
      return {
        id: `code-${forwarded.length}`,
        code: "raw-onboarding-code",
        eventId: input.eventId,
        eventName: input.eventName,
        teamId: "event-team",
        role: "member",
        maxUses: input.maxUses ?? 50,
        usedCount: 0,
        expiresAt: input.expiresAt,
        revokedAt: null,
        createdAt: now,
      };
    },
  }),
  router: {},
};

const HOUR = 3_600_000;

function eventInput(ownerNodeId: string, overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    ownerNodeId,
    nodeIds: [ownerNodeId],
    kind: "event" as const,
    title: "Builders Night",
    summary: "Meet the builders",
    url: `https://example.com/events/${crypto.randomUUID()}`,
    source: "Community",
    publishedAt: new Date(now).toISOString(),
    startsAt: new Date(now + 24 * HOUR).toISOString(),
    endsAt: new Date(now + 27 * HOUR).toISOString(),
    timezone: "UTC",
    venue: "Town Hall",
    status: "published" as const,
    ...overrides,
  };
}

async function organizationNode() {
  const id = crypto.randomUUID().slice(0, 8);
  const org = `event-onboarding-${id}`;
  const provisioner = await getPluginClient(daoContext(`prov-${id}`, org, `eo-${id}.near`));
  const tenant = await provisioner.createTenant({ name: "Event city", accountId: `eo-${id}.near` });
  const node = await provisioner.createNode({
    name: "Event city",
    slug: `event-city-${id}`,
    kind: "city",
    tenantId: tenant.id,
  });
  return { org, node, editor: await getPluginClient(orgContext(`editor-${id}`, org)) };
}

function organizerClient(org: string) {
  return getPluginClient({
    ...orgContext("organizer", org, "member"),
    reqHeaders: { cookie: "better-auth.session_token=organizer" },
  });
}

const orphanEventId = crypto.randomUUID();

async function seedEventOnNodeWithoutOrganization() {
  const slug = pluginMigrationSlug(pluginDevConfig.pluginId);
  const schemaName = `plugin_${slug}`;
  const driver = await createDatabaseDriver(`pglite:${databaseDir}`, schemaName);
  try {
    const { migrations } = await Effect.runPromise(loadMigrations());
    await Effect.runPromise(migrate(driver.db, migrations, getMigrationStorage(slug), schemaName));
    const [tenant] = await driver.db
      .insert(tenants)
      .values({ name: "Solo app", accountId: "solo-app.near", orgId: null, ownerKind: "user" })
      .returning();
    const [node] = await driver.db
      .insert(nodes)
      .values({
        slug: "solo-city",
        name: "Solo city",
        tenantId: tenant!.id,
        metadata: { kind: "city" },
      })
      .returning();
    const event = { ...eventInput(node!.id), id: orphanEventId };
    await driver.db.insert(discoveryActivities).values({
      id: orphanEventId,
      ownerNodeId: node!.id,
      canonicalUrl: event.url,
      data: event,
    });
  } finally {
    await driver.close();
  }
}

beforeAll(async () => {
  await seedEventOnNodeWithoutOrganization();
  await getPluginClient(undefined, { auth: authStub } as never);
}, 60_000);

afterAll(async () => {
  await teardown();
  rmSync(databaseDir, { recursive: true, force: true });
});

describe("creating an onboarding code for a Node Event", () => {
  it("forwards the event's organization, id, title and a default expiry of end + 48h", async () => {
    const { org, node, editor } = await organizationNode();
    const event = await editor.saveDiscoveryActivity(eventInput(node.id));
    const organizer = await organizerClient(org);

    const created = await organizer.createEventOnboardingCode({ eventId: event.id, maxUses: 120 });

    expect(created.code).toBe("raw-onboarding-code");
    expect(forwarded.at(-1)).toEqual({
      context: { reqHeaders: { cookie: "better-auth.session_token=organizer" } },
      input: {
        organizationId: org,
        eventId: event.id,
        eventName: "Builders Night",
        maxUses: 120,
        expiresAt: new Date(Date.parse(event.endsAt!) + 48 * HOUR),
      },
    });
  });

  it("forwards an explicit expiry instead of the default", async () => {
    const { org, node, editor } = await organizationNode();
    const event = await editor.saveDiscoveryActivity(eventInput(node.id));
    const organizer = await organizerClient(org);
    const expiresAt = new Date(Date.now() + 6 * HOUR).toISOString();

    await organizer.createEventOnboardingCode({ eventId: event.id, expiresAt });

    expect(forwarded.at(-1)?.input.expiresAt).toEqual(new Date(expiresAt));
  });

  it("refuses an activity that is not an event", async () => {
    const { org, node, editor } = await organizationNode();
    const post = await editor.saveDiscoveryActivity(
      eventInput(node.id, { kind: "social", startsAt: null, endsAt: null, title: "An update" }),
    );
    const organizer = await organizerClient(org);

    await expect(organizer.createEventOnboardingCode({ eventId: post.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/only events/i),
    });
  });

  it("refuses an unknown event", async () => {
    const { org } = await organizationNode();
    const organizer = await organizerClient(org);

    await expect(
      organizer.createEventOnboardingCode({ eventId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses an event whose node has no organization", async () => {
    const organizer = await organizerClient(`some-org-${crypto.randomUUID().slice(0, 8)}`);

    await expect(
      organizer.createEventOnboardingCode({ eventId: orphanEventId }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/no organization/i),
    });
  });

  it("refuses an event that belongs to another organization than the active one", async () => {
    const { node, editor } = await organizationNode();
    const event = await editor.saveDiscoveryActivity(eventInput(node.id));
    const outsider = await organizerClient(`other-org-${crypto.randomUUID().slice(0, 8)}`);
    const before = forwarded.length;

    await expect(outsider.createEventOnboardingCode({ eventId: event.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringMatching(/another organization/i),
    });
    expect(forwarded).toHaveLength(before);
  });
});
