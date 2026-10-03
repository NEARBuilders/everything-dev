import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../src/db/schema";
import { sweepOrphanUsers } from "../../src/orphan-sweep";
import type { PluginServices } from "../../src/service-types";
import { createTestServices } from "../helpers";

const HOUR_MS = 60 * 60 * 1000;

function later(ms: number) {
  return new Date(Date.now() + ms);
}

async function abandonPasskeyRegistration(services: PluginServices): Promise<string> {
  const before = new Set((await services.db.select().from(schema.user)).map(({ id }) => id));
  const res = await services.handler(
    new Request("http://localhost:3000/api/auth/passkey/generate-register-options", {
      method: "GET",
    }),
  );
  expect(res.status).toBe(200);
  const created = (await services.db.select().from(schema.user)).find(({ id }) => !before.has(id));
  if (!created) throw new Error("registration did not create a user");
  return created.id;
}

async function userExists(services: PluginServices, userId: string) {
  const [found] = await services.db.select().from(schema.user).where(eq(schema.user.id, userId));
  return !!found;
}

async function personalOrganizationExists(services: PluginServices, userId: string) {
  const [found] = await services.db
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.slug, userId));
  return !!found;
}

describe("orphan sweep", () => {
  let services: PluginServices;

  beforeEach(async () => {
    ({ services } = await createTestServices());
  });

  it("deletes an abandoned passkey registration older than an hour with its personal organization", async () => {
    const userId = await abandonPasskeyRegistration(services);
    expect(await personalOrganizationExists(services, userId)).toBe(true);

    await sweepOrphanUsers(services.db, later(HOUR_MS + 60_000));

    expect(await userExists(services, userId)).toBe(false);
    expect(await personalOrganizationExists(services, userId)).toBe(false);
  });

  it("spares an abandoned registration younger than an hour", async () => {
    const userId = await abandonPasskeyRegistration(services);

    await sweepOrphanUsers(services.db, later(HOUR_MS / 2));

    expect(await userExists(services, userId)).toBe(true);
    expect(await personalOrganizationExists(services, userId)).toBe(true);
  });

  it("spares users with a passkey, a NEAR account, another account, a session or a phone number", async () => {
    const withPasskey = await abandonPasskeyRegistration(services);
    await services.db.insert(schema.passkey).values({
      id: crypto.randomUUID(),
      userId: withPasskey,
      publicKey: "cose",
      credentialID: crypto.randomUUID(),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
    });
    const withNearAccount = await abandonPasskeyRegistration(services);
    await services.db.insert(schema.nearAccount).values({
      id: crypto.randomUUID(),
      userId: withNearAccount,
      accountId: "alice.near",
      network: "mainnet",
      publicKey: "ed25519:placeholder",
      isPrimary: true,
      createdAt: new Date(),
    });
    const withAccount = await abandonPasskeyRegistration(services);
    await services.db.insert(schema.account).values({
      id: crypto.randomUUID(),
      userId: withAccount,
      accountId: "github-1",
      providerId: "github",
    });
    const withSession = await abandonPasskeyRegistration(services);
    await services.db.insert(schema.session).values({
      id: crypto.randomUUID(),
      userId: withSession,
      token: crypto.randomUUID(),
      expiresAt: later(24 * HOUR_MS),
    });
    const withPhone = await abandonPasskeyRegistration(services);
    await services.db
      .update(schema.user)
      .set({ phoneNumber: "+15555550100" })
      .where(eq(schema.user.id, withPhone));
    const orphan = await abandonPasskeyRegistration(services);

    await sweepOrphanUsers(services.db, later(2 * HOUR_MS));

    for (const userId of [withPasskey, withNearAccount, withAccount, withSession, withPhone]) {
      expect(await userExists(services, userId)).toBe(true);
      expect(await personalOrganizationExists(services, userId)).toBe(true);
    }
    expect(await userExists(services, orphan)).toBe(false);
  });
});
