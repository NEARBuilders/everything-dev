import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseTag } from "../../src/db/layer";
import * as schema from "../../src/db/schema";
import { AuthApiTag } from "../../src/service-types";
import { buildPermissionsService, PermissionsService } from "../../src/services/permissions";
import { addTestMember, createTestOrg, createTestServices, createTestUser } from "../helpers";

let services: Awaited<ReturnType<typeof createTestServices>>;

beforeAll(async () => {
  services = await createTestServices();
}, 30000);

afterAll(async () => {
  await services.driver.close();
}, 30000);

function permissionsLayer() {
  return Layer.succeed(
    PermissionsService,
    Effect.runSync(
      Effect.gen(function* () {
        const auth = (yield* AuthApiTag).auth;
        const db = yield* DatabaseTag;
        return buildPermissionsService({ auth, db });
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(AuthApiTag, {
              auth: services.services.auth,
              handler: services.services.handler,
              apiKeyHeaders: services.services.apiKeyHeaders,
            }),
            Layer.succeed(DatabaseTag, services.services.db),
          ),
        ),
      ),
    ),
  );
}

function runRequireOrganizer(
  caller: {
    reqHeaders?: Record<string, string>;
    userId: string;
    user: { id: string };
    activeOrganizationId?: string | null;
  },
  organizationId?: string,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* PermissionsService;
      return yield* permissions.requireOrganizer(caller as never, organizationId);
    }).pipe(Effect.provide(permissionsLayer())),
  );
}

describe("PermissionsService.requireOrganizer", () => {
  it("resolves the active org and approves owners", async () => {
    const owner = await createTestUser(services.services);
    const org = await createTestOrg(services.services, owner.userId);
    await services.services.db
      .update(schema.session)
      .set({ activeOrganizationId: org.id })
      .where(eq(schema.session.token, owner.token));

    const result = await runRequireOrganizer({
      reqHeaders: owner.reqHeaders,
      userId: owner.userId,
      user: { id: owner.userId },
      activeOrganizationId: org.id,
    });
    expect(result.organizationId).toBe(org.id);
  });

  it("denies plain organization members", async () => {
    const owner = await createTestUser(services.services);
    const member = await createTestUser(services.services, {
      email: `pm-${crypto.randomUUID()}@example.com`,
    });
    const org = await createTestOrg(services.services, owner.userId);
    await addTestMember(services.services, org.id, member.userId, "member");
    await services.services.db
      .update(schema.session)
      .set({ activeOrganizationId: org.id })
      .where(eq(schema.session.token, member.token));

    await expect(
      runRequireOrganizer({
        reqHeaders: member.reqHeaders,
        userId: member.userId,
        user: { id: member.userId },
        activeOrganizationId: org.id,
      }),
    ).rejects.toMatchObject({ _tag: "NotOrganizer" });
  });
});
